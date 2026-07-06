-- ============================================================
-- 06_v4.sql — v4: communities (주제), community post images,
-- item location + item likes + status, reports, user blocks (쪽지 차단),
-- visit counters.
-- Idempotent: safe to re-run. Run LAST: 01 -> 02 -> 03 -> 04 -> 05 -> 06.
-- 02 revokes execute on ALL functions in public, so this file must be
-- (re-)run after 02 to restore the per-function grants below. It is
-- self-contained: it re-issues every grant it needs.
--
-- Conventions follow 03_functions.sql / 05_messages_likes.sql: all public
-- RPCs are security definer, search_path = public, extensions, with a
-- per-function revoke-from-public + explicit grant right after each
-- definition. Helpers (prefixed _) get NO grant.
--
-- Machine-readable error messages (client maps them to Korean):
--   auth_required, forbidden, not_found, invalid_input, rate_limited
-- ============================================================

-- ============================================================
-- Tables
-- ============================================================

-- ---------- communities (주제) ----------
-- (Also created by the v4 forward-compat block in 01_schema.sql, because
-- posts_view there references it; identical idempotent DDL.)
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null check (slug ~ '^[a-z0-9-]{2,30}$'),
  name        text not null check (char_length(name) between 1 and 30),
  description text not null default '',
  sort_order  int not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- community_id + image_paths on posts ----------
alter table public.posts add column if not exists community_id uuid references public.communities(id);
alter table public.posts add column if not exists image_paths text[] not null default '{}'
  check (array_length(image_paths, 1) is null or array_length(image_paths, 1) <= 8);

-- ---------- item 거래지역 ----------
-- Nullable so legacy rows stay valid; new items must supply a valid region
-- (validated in create_item against REGIONS, not by a table check).
alter table public.items add column if not exists location text;

-- ---------- item likes ----------
create table if not exists public.item_likes (
  item_id    uuid not null references public.items(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (item_id, user_id)
);

-- ---------- reports (비공개) ----------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'item', 'post_comment', 'item_comment', 'message')),
  target_id   uuid not null,
  reason      text not null check (char_length(reason) between 1 and 50),
  note        text not null default '' check (char_length(note) <= 1000),
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now()
);

-- ---------- user_blocks (쪽지 차단) ----------
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id)
);

-- ---------- visits ----------
create table if not exists public.daily_visits (
  day   date primary key,
  count integer not null default 0
);

create table if not exists public.site_counters (
  key   text primary key,
  value bigint not null default 0
);

-- ---------- indexes ----------

create index if not exists item_likes_item_id_created_at_idx
  on public.item_likes (item_id, created_at desc);

create index if not exists reports_status_created_at_idx
  on public.reports (status, created_at desc);

-- ---------- RLS / table privileges ----------
-- RLS on, NO policies (deny-all), same as every other table. 02's broad
-- revoke ran before these tables existed, so revoke explicitly here.

alter table public.communities   enable row level security;
alter table public.item_likes    enable row level security;
alter table public.reports        enable row level security;
alter table public.user_blocks   enable row level security;
alter table public.daily_visits  enable row level security;
alter table public.site_counters enable row level security;

revoke all on public.communities   from public, anon, authenticated;
revoke all on public.item_likes    from public, anon, authenticated;
revoke all on public.reports        from public, anon, authenticated;
revoke all on public.user_blocks   from public, anon, authenticated;
revoke all on public.daily_visits  from public, anon, authenticated;
revoke all on public.site_counters from public, anon, authenticated;

-- ============================================================
-- Seed communities (idempotent)
-- ============================================================

insert into public.communities (slug, name, description, sort_order) values
  ('free',    '자유게시판', '자유롭게 소통하는 공간',            1),
  ('suggest', '건의함',     '관리자에게 건의할 내용을 남겨주세요', 2)
on conflict (slug) do nothing;

-- Backfill: adopt existing posts into the default '자유게시판' community.
update public.posts
   set community_id = (select id from public.communities where slug = 'free')
 where community_id is null;

-- ============================================================
-- View: communities_view (public read — active only)
-- ============================================================

drop view if exists public.communities_view;

create view public.communities_view as
select
  c.id,
  c.slug,
  c.name,
  c.description,
  c.sort_order
from public.communities c
where c.is_active
order by c.sort_order, c.name;

revoke all on public.communities_view from public, anon, authenticated;
grant select on public.communities_view to anon, authenticated;

-- ============================================================
-- Private helper: validate an item region against REGIONS
-- (no grant — see revoke at end of file)
-- ============================================================

create or replace function public._check_region(p text)
returns void
language plpgsql
as $$
begin
  if p is null or not (p = any (array[
    '주롱',
    '부킷티마/클레멘티',
    '우드랜즈/이슌',
    '앙모키오/비샨',
    '세랑군/호우강',
    '풍골/셍캉',
    '탬피니스/파시르리스',
    '베독/이스트코스트',
    '시티/오차드',
    '노비나/토아파요',
    '하버프론트/센토사',
    '기타(싱가포르 내)',
    '싱가포르 외'
  ])) then
    raise exception using message = 'invalid_input', errcode = 'P0001';
  end if;
end;
$$;

-- ============================================================
-- Communities admin RPCs
-- ============================================================

create or replace function public.create_community(
  p_slug        text,
  p_name        text,
  p_description text default '',
  p_sort_order  int  default 100
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := public._uid();
  v_slug  text := lower(trim(coalesce(p_slug, '')));
  v_name  text := trim(coalesce(p_name, ''));
  v_desc  text := trim(coalesce(p_description, ''));
  v_id    uuid;
begin
  if not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  if v_slug !~ '^[a-z0-9-]{2,30}$' then
    perform _raise('invalid_input');
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_desc) > 500 then
    perform _raise('invalid_input');
  end if;

  insert into communities (slug, name, description, sort_order)
  values (v_slug, v_name, v_desc, coalesce(p_sort_order, 100))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_community(text, text, text, int) from public;
grant  execute on function public.create_community(text, text, text, int) to authenticated;

create or replace function public.update_community(
  p_id          uuid,
  p_name        text,
  p_description text,
  p_sort_order  int,
  p_is_active   boolean
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := public._uid();
  v_name text := trim(coalesce(p_name, ''));
  v_desc text := trim(coalesce(p_description, ''));
begin
  if not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  if not exists (select 1 from communities where id = p_id) then
    perform _raise('not_found');
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_desc) > 500 then
    perform _raise('invalid_input');
  end if;

  update communities
     set name        = v_name,
         description = v_desc,
         sort_order  = coalesce(p_sort_order, 100),
         is_active   = coalesce(p_is_active, true)
   where id = p_id;
end;
$$;

revoke execute on function public.update_community(uuid, text, text, int, boolean) from public;
grant  execute on function public.update_community(uuid, text, text, int, boolean) to authenticated;

-- ============================================================
-- Items: create_item with location (overrides 03's 5-arg version)
-- Drop the old signature so no location-less entry point survives.
-- ============================================================

drop function if exists public.create_item(text, text, integer, text, text[]);

create or replace function public.create_item(
  p_title       text,
  p_category    text,
  p_price       integer,
  p_description text,
  p_location    text,
  p_image_paths text[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid         uuid   := public._uid();
  v_title       text   := trim(coalesce(p_title, ''));
  v_category    text   := trim(coalesce(p_category, ''));
  v_description text   := trim(coalesce(p_description, ''));
  v_location    text   := trim(coalesce(p_location, ''));
  v_paths       text[] := coalesce(p_image_paths, '{}');
  v_id          uuid;
begin
  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform _raise('invalid_input');
  end if;
  perform _check_category(v_category);
  if p_price is null or p_price < 0 or p_price > 1000000 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_description) > 5000 then
    perform _raise('invalid_input');
  end if;
  perform _check_region(v_location);
  if coalesce(array_length(v_paths, 1), 0) > 8 then
    perform _raise('invalid_input');
  end if;

  perform _check_rate('create_item', 5, interval '10 minutes');

  insert into items (title, category, price, description, location, image_paths, user_id)
  values (v_title, v_category, p_price, v_description, v_location, v_paths, v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_item(text, text, integer, text, text, text[]) from public;
grant  execute on function public.create_item(text, text, integer, text, text, text[]) to authenticated;

-- Edit item with 거래지역 (overrides 03's 7-arg version). Drop the old
-- signature so the location-less edit path no longer exists.
drop function if exists public.update_item(uuid, text, text, integer, text, text[], text);

create or replace function public.update_item(
  p_id          uuid,
  p_title       text,
  p_category    text,
  p_price       integer,
  p_description text,
  p_image_paths text[],
  p_status      text,
  p_location    text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid         uuid   := public._uid();
  v_owner       uuid;
  v_title       text   := trim(coalesce(p_title, ''));
  v_category    text   := trim(coalesce(p_category, ''));
  v_description text   := trim(coalesce(p_description, ''));
  v_location    text   := trim(coalesce(p_location, ''));
  v_paths       text[] := coalesce(p_image_paths, '{}');
  v_status      text   := trim(coalesce(p_status, ''));
begin
  select user_id into v_owner from items where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  -- owner only (admins may delete, but not edit, others' content)
  if v_owner is distinct from v_uid then
    perform _raise('forbidden');
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform _raise('invalid_input');
  end if;
  perform _check_category(v_category);
  if p_price is null or p_price < 0 or p_price > 1000000 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_description) > 5000 then
    perform _raise('invalid_input');
  end if;
  perform _check_region(v_location);
  if coalesce(array_length(v_paths, 1), 0) > 8 then
    perform _raise('invalid_input');
  end if;
  if v_status not in ('selling', 'reserved', 'sold') then
    perform _raise('invalid_input');
  end if;

  update items
     set title       = v_title,
         category    = v_category,
         price       = p_price,
         description = v_description,
         location    = v_location,
         image_paths = v_paths,
         status      = v_status,
         updated_at  = now()
   where id = p_id;
end;
$$;

revoke execute on function public.update_item(uuid, text, text, integer, text, text[], text, text) from public;
grant  execute on function public.update_item(uuid, text, text, integer, text, text[], text, text) to authenticated;

-- ============================================================
-- Posts: create_post with community_id + image_paths (overrides 03's
-- 3-arg version). Drop the old signature so no community-less entry point
-- survives; a null community defaults to '자유게시판' (free).
-- ============================================================

drop function if exists public.create_post(text, text, boolean);

create or replace function public.create_post(
  p_title        text,
  p_content      text,
  p_is_anonymous boolean default false,
  p_community_id uuid   default null,
  p_image_paths  text[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid    := public._uid();
  v_title     text    := trim(coalesce(p_title, ''));
  v_content   text    := trim(coalesce(p_content, ''));
  v_anon      boolean := coalesce(p_is_anonymous, false);
  v_paths     text[]  := coalesce(p_image_paths, '{}');
  v_community uuid;
  v_id        uuid;
begin
  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 20000 then
    perform _raise('invalid_input');
  end if;
  if coalesce(array_length(v_paths, 1), 0) > 8 then
    perform _raise('invalid_input');
  end if;

  -- resolve community: null -> default '자유게시판'; otherwise must be active
  if p_community_id is null then
    select id into v_community from communities where slug = 'free';
  else
    select id into v_community from communities where id = p_community_id and is_active;
    if not found then
      perform _raise('invalid_input');
    end if;
  end if;

  perform _check_rate('create_post', 5, interval '10 minutes');

  insert into posts (title, content, is_anonymous, community_id, image_paths, user_id, author_name)
  values (v_title, v_content, v_anon, v_community, v_paths, v_uid, null)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_post(text, text, boolean, uuid, text[]) from public;
grant  execute on function public.create_post(text, text, boolean, uuid, text[]) to authenticated;

-- Edit post with community_id + image_paths (overrides 03's 4-arg
-- version). Drop the old signature so the community/image-less edit path
-- no longer exists; a null community defaults to '자유게시판' (free).
drop function if exists public.update_post(uuid, text, text, boolean);

create or replace function public.update_post(
  p_id           uuid,
  p_title        text,
  p_content      text,
  p_is_anonymous boolean,
  p_community_id uuid,
  p_image_paths  text[]
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid    := public._uid();
  v_owner     uuid;
  v_title     text    := trim(coalesce(p_title, ''));
  v_content   text    := trim(coalesce(p_content, ''));
  v_anon      boolean := coalesce(p_is_anonymous, false);
  v_paths     text[]  := coalesce(p_image_paths, '{}');
  v_community uuid;
begin
  select user_id into v_owner from posts where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  -- owner only (admins may delete, but not edit, others' content)
  if v_owner is distinct from v_uid then
    perform _raise('forbidden');
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 20000 then
    perform _raise('invalid_input');
  end if;
  if coalesce(array_length(v_paths, 1), 0) > 8 then
    perform _raise('invalid_input');
  end if;

  -- resolve community: null -> default '자유게시판'; otherwise must be active
  if p_community_id is null then
    select id into v_community from communities where slug = 'free';
  else
    select id into v_community from communities where id = p_community_id and is_active;
    if not found then
      perform _raise('invalid_input');
    end if;
  end if;

  update posts
     set title        = v_title,
         content      = v_content,
         is_anonymous = v_anon,
         community_id = v_community,
         image_paths  = v_paths,
         updated_at   = now()
   where id = p_id;
end;
$$;

revoke execute on function public.update_post(uuid, text, text, boolean, uuid, text[]) from public;
grant  execute on function public.update_post(uuid, text, text, boolean, uuid, text[]) to authenticated;

-- ============================================================
-- Item likes
-- ============================================================

create or replace function public.toggle_item_like(
  p_item_id uuid
) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := public._uid();
  v_liked boolean;
  v_count integer;
begin
  if not exists (select 1 from items where id = p_item_id) then
    perform _raise('not_found');
  end if;

  perform _check_rate('toggle_like', 30, interval '10 minutes');

  delete from item_likes where item_id = p_item_id and user_id = v_uid;
  if found then
    v_liked := false;
  else
    insert into item_likes (item_id, user_id)
    values (p_item_id, v_uid)
    on conflict (item_id, user_id) do nothing;
    v_liked := true;
  end if;

  select count(*)::integer into v_count
    from item_likes where item_id = p_item_id;

  return json_build_object('liked', v_liked, 'like_count', v_count);
end;
$$;

revoke execute on function public.toggle_item_like(uuid) from public;
grant  execute on function public.toggle_item_like(uuid) to authenticated;

-- ============================================================
-- Item status (owner-only quick toggle)
-- ============================================================

create or replace function public.set_item_status(
  p_id     uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := public._uid();
  v_owner  uuid;
  v_status text := trim(coalesce(p_status, ''));
begin
  select user_id into v_owner from items where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  if v_owner is distinct from v_uid then
    perform _raise('forbidden');
  end if;

  if v_status not in ('selling', 'reserved', 'sold') then
    perform _raise('invalid_input');
  end if;

  update items
     set status     = v_status,
         updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.set_item_status(uuid, text) from public;
grant  execute on function public.set_item_status(uuid, text) to authenticated;

-- ============================================================
-- Reports (비공개 — only the reporter writes; only admins read)
-- ============================================================

create or replace function public.create_report(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text,
  p_note        text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := public._uid();
  v_type   text := trim(coalesce(p_target_type, ''));
  v_reason text := trim(coalesce(p_reason, ''));
  v_note   text := trim(coalesce(p_note, ''));
  v_id     uuid;
begin
  if v_type not in ('post', 'item', 'post_comment', 'item_comment', 'message') then
    perform _raise('invalid_input');
  end if;
  if p_target_id is null then
    perform _raise('invalid_input');
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 50 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_note) > 1000 then
    perform _raise('invalid_input');
  end if;

  perform _check_rate('create_report', 10, interval '60 minutes');

  insert into reports (reporter_id, target_type, target_id, reason, note)
  values (v_uid, v_type, p_target_id, v_reason, v_note)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_report(text, uuid, text, text) from public;
grant  execute on function public.create_report(text, uuid, text, text) to authenticated;

create or replace function public.admin_reports(
  p_status text default 'open'
) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := public._uid();
  v_status text := trim(coalesce(p_status, 'open'));
  v_result json;
begin
  if not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  if v_status not in ('open', 'resolved') then
    perform _raise('invalid_input');
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
    into v_result
    from (
      select
        r.id,
        r.target_type,
        r.target_id,
        r.reason,
        r.note,
        r.status,
        coalesce(pr.username, '(탈퇴)') as reporter_username,
        r.created_at
      from reports r
      left join profiles pr on pr.id = r.reporter_id
      where r.status = v_status
    ) t;

  return v_result;
end;
$$;

revoke execute on function public.admin_reports(text) from public;
grant  execute on function public.admin_reports(text) to authenticated;

create or replace function public.resolve_report(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public._uid();
begin
  if not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  if not exists (select 1 from reports where id = p_id) then
    perform _raise('not_found');
  end if;

  update reports set status = 'resolved' where id = p_id;
end;
$$;

revoke execute on function public.resolve_report(uuid) from public;
grant  execute on function public.resolve_report(uuid) to authenticated;

-- ============================================================
-- User blocks (쪽지 차단)
-- ============================================================

create or replace function public.block_user(
  p_username text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := public._uid();
  v_blocked uuid;
begin
  select id into v_blocked
    from profiles
   where lower(username) = lower(trim(coalesce(p_username, '')));
  if not found then
    perform _raise('not_found');
  end if;

  if v_blocked = v_uid then
    perform _raise('invalid_input');  -- cannot block yourself
  end if;

  insert into user_blocks (blocker_id, blocked_id)
  values (v_uid, v_blocked)
  on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

revoke execute on function public.block_user(text) from public;
grant  execute on function public.block_user(text) to authenticated;

create or replace function public.unblock_user(
  p_username text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := public._uid();
  v_blocked uuid;
begin
  select id into v_blocked
    from profiles
   where lower(username) = lower(trim(coalesce(p_username, '')));
  if not found then
    perform _raise('not_found');
  end if;

  delete from user_blocks
   where blocker_id = v_uid and blocked_id = v_blocked;
end;
$$;

revoke execute on function public.unblock_user(text) from public;
grant  execute on function public.unblock_user(text) to authenticated;

create or replace function public.my_blocks()
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when auth.uid() is null then '[]'::json
    else coalesce(
      (select json_agg(pr.username order by pr.username)
         from public.user_blocks ub
         join public.profiles pr on pr.id = ub.blocked_id
        where ub.blocker_id = auth.uid()),
      '[]'::json
    )
  end;
$$;

revoke execute on function public.my_blocks() from public;
grant  execute on function public.my_blocks() to authenticated;

-- ============================================================
-- Override _send_message (05) to enforce user blocks.
-- Same signature as 05's version, so this cleanly replaces it when 06
-- runs last. Body is identical to 05's except for the block check.
-- ============================================================

create or replace function public._send_message(
  p_sender        uuid,
  p_recipient     uuid,
  p_content       text,
  p_context_type  text,
  p_context_id    uuid,
  p_context_title text
) returns uuid
language plpgsql
as $$
declare
  v_content text := trim(coalesce(p_content, ''));
  v_id      uuid;
begin
  if p_recipient is null then
    perform _raise('not_found');
  end if;
  if p_recipient = p_sender then
    perform _raise('invalid_input');  -- no messaging yourself
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 2000 then
    perform _raise('invalid_input');
  end if;

  -- v4 messaging blocks (쪽지 차단):
  --   recipient blocked sender  -> forbidden (they refuse messages from sender)
  --   sender blocked recipient  -> forbidden (note: forbidden, not invalid_input,
  --                                to reuse the single client-side error path)
  if exists (
    select 1 from user_blocks
     where blocker_id = p_recipient and blocked_id = p_sender
  ) then
    perform _raise('forbidden');
  end if;
  if exists (
    select 1 from user_blocks
     where blocker_id = p_sender and blocked_id = p_recipient
  ) then
    perform _raise('forbidden');
  end if;

  perform _check_rate('send_message', 20, interval '10 minutes');

  insert into messages (sender_id, recipient_id, content,
                        context_type, context_id, context_title)
  values (p_sender, p_recipient, v_content,
          p_context_type, p_context_id, p_context_title)
  returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================
-- Visits
-- ============================================================

-- Bump today's counter and the running total. Wrapped so it can NEVER
-- error the client (fire-and-forget from the page). No rate limit — the
-- client dedupes per session/day.
create or replace function public.record_visit()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    insert into daily_visits (day, count)
    values (current_date, 1)
    on conflict (day) do update set count = daily_visits.count + 1;

    insert into site_counters (key, value)
    values ('total', 1)
    on conflict (key) do update set value = site_counters.value + 1;
  exception when others then
    null;  -- never surface a visit-counter error to the client
  end;
end;
$$;

revoke execute on function public.record_visit() from public;
grant  execute on function public.record_visit() to anon, authenticated;

-- Running total + today's count. NEVER raises.
create or replace function public.visit_stats()
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select json_build_object(
    'total', coalesce((select value from public.site_counters where key = 'total'), 0),
    'today', coalesce((select count from public.daily_visits where day = current_date), 0)
  );
$$;

revoke execute on function public.visit_stats() from public;
grant  execute on function public.visit_stats() to anon, authenticated;

-- ============================================================
-- Storage: broaden item-images policies to allow the posts/ prefix too
-- (community post images live under posts/<uuid>/<i>.webp). Bodies copied
-- from 04_storage.sql with the name predicate widened.
-- ============================================================

drop policy if exists "item_images_select" on storage.objects;
create policy "item_images_select"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'item-images'
    and (name like 'items/%' or name like 'posts/%')
  );

drop policy if exists "item_images_insert" on storage.objects;
create policy "item_images_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'item-images'
    and (name like 'items/%' or name like 'posts/%')
  );

drop policy if exists "item_images_delete" on storage.objects;
create policy "item_images_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'item-images'
    and (name like 'items/%' or name like 'posts/%')
  );

-- ============================================================
-- Lock down helpers (belt and braces, same as 03 / 05)
-- ============================================================

revoke execute on function public._check_region(text) from public, anon, authenticated;
revoke execute on function public._send_message(uuid, uuid, text, text, uuid, text)
  from public, anon, authenticated;

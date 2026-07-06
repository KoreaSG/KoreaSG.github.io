-- ============================================================
-- 05_messages_likes.sql — v3: direct messages (쪽지), post likes,
-- view counts
-- Idempotent: safe to re-run. Run LAST: 01 -> 02 -> 03 -> 04 -> 05.
-- 02 revokes execute on ALL functions in public, so this file must be
-- (re-)run after 02 to restore the per-function grants below. It is
-- self-contained: it re-issues every grant it needs.
--
-- Conventions follow 03_functions.sql: all public RPCs are
-- security definer, search_path = public, extensions, with a
-- per-function revoke-from-public + explicit grant right after each
-- definition. Helpers (prefixed _) get NO grant.
--
-- Machine-readable error messages (client maps them to Korean):
--   auth_required, forbidden, not_found, invalid_input, rate_limited
-- ============================================================

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.messages (
  id                uuid primary key default gen_random_uuid(),
  sender_id         uuid not null references auth.users(id) on delete cascade,
  recipient_id      uuid not null references auth.users(id) on delete cascade,
  content           text not null check (char_length(content) between 1 and 2000),
  context_type      text check (context_type in ('item', 'post')),
  context_id        uuid,  -- intentionally NOT a FK: the item/post may be deleted later
  context_title     text,  -- snapshot of the item/post title at send time
  read_at           timestamptz,
  sender_deleted    boolean not null default false,
  recipient_deleted boolean not null default false,
  created_at        timestamptz not null default now()
);

-- (post_likes and the view_count columns are also created by the
-- forward-compat block in 01_schema.sql, because the views there
-- reference them; identical DDL, both idempotent.)
create table if not exists public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);

alter table public.posts add column if not exists view_count integer not null default 0;
alter table public.items add column if not exists view_count integer not null default 0;

-- ---------- indexes ----------

create index if not exists messages_recipient_id_created_at_idx
  on public.messages (recipient_id, created_at desc);

create index if not exists messages_sender_id_created_at_idx
  on public.messages (sender_id, created_at desc);

create index if not exists post_likes_post_id_created_at_idx
  on public.post_likes (post_id, created_at desc);

-- ---------- RLS / table privileges ----------
-- RLS on, NO policies (deny-all), same as every other table. 02's broad
-- revoke ran before these tables existed, so revoke explicitly here.

alter table public.messages   enable row level security;
alter table public.post_likes enable row level security;

revoke all on public.messages   from public, anon, authenticated;
revoke all on public.post_likes from public, anon, authenticated;

-- ============================================================
-- View: my_messages_view (authenticated ONLY)
-- Never exposes raw sender_id / recipient_id — only the direction and
-- the counterpart's username ('(탈퇴)' when the profile is gone).
-- ============================================================

drop view if exists public.my_messages_view;

create view public.my_messages_view as
select
  m.id,
  case when auth.uid() = m.recipient_id then 'in' else 'out' end as direction,
  coalesce(pr.username, '(탈퇴)') as counterpart_username,
  m.content,
  m.context_type,
  m.context_id,
  m.context_title,
  m.read_at,
  m.created_at
from public.messages m
left join public.profiles pr
  on pr.id = case when auth.uid() = m.recipient_id
                  then m.sender_id
                  else m.recipient_id
             end
where auth.uid() in (m.sender_id, m.recipient_id)
  and not (auth.uid() = m.sender_id    and m.sender_deleted)
  and not (auth.uid() = m.recipient_id and m.recipient_deleted);

revoke all on public.my_messages_view from public, anon, authenticated;
grant select on public.my_messages_view to authenticated;

-- ============================================================
-- Private helper (no grant — see revoke at end of file)
-- ============================================================

-- Shared send path: validates content, blocks self-send, rate-limits
-- (ALL send RPCs share the 'send_message' action: 20 / 10 minutes),
-- inserts, returns the new message id.
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
-- Messages (쪽지)
-- ============================================================

create or replace function public.send_message_to_item(
  p_item_id uuid,
  p_content text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := public._uid();
  v_owner uuid;
  v_title text;
begin
  select user_id, title into v_owner, v_title
    from items where id = p_item_id;
  if not found then
    perform _raise('not_found');
  end if;
  -- ownerless legacy rows have nobody to receive the message
  if v_owner is null then
    perform _raise('not_found');
  end if;

  return public._send_message(v_uid, v_owner, p_content,
                              'item', p_item_id, v_title);
end;
$$;

revoke execute on function public.send_message_to_item(uuid, text) from public;
grant  execute on function public.send_message_to_item(uuid, text) to authenticated;

create or replace function public.send_message_to_post(
  p_post_id uuid,
  p_content text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := public._uid();
  v_owner uuid;
  v_title text;
  v_anon  boolean;
begin
  select user_id, title, is_anonymous into v_owner, v_title, v_anon
    from posts where id = p_post_id;
  if not found then
    perform _raise('not_found');
  end if;

  -- protect anonymity: a message thread would deanonymize the author
  if v_anon then
    perform _raise('forbidden');
  end if;

  if v_owner is null then
    perform _raise('not_found');
  end if;

  return public._send_message(v_uid, v_owner, p_content,
                              'post', p_post_id, v_title);
end;
$$;

revoke execute on function public.send_message_to_post(uuid, text) from public;
grant  execute on function public.send_message_to_post(uuid, text) to authenticated;

create or replace function public.send_message_to_user(
  p_username text,
  p_content  text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid := public._uid();
  v_recipient uuid;
begin
  select id into v_recipient
    from profiles
   where lower(username) = lower(trim(coalesce(p_username, '')));
  if not found then
    perform _raise('not_found');
  end if;

  return public._send_message(v_uid, v_recipient, p_content,
                              null, null, null);
end;
$$;

revoke execute on function public.send_message_to_user(text, text) from public;
grant  execute on function public.send_message_to_user(text, text) to authenticated;

create or replace function public.mark_message_read(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid := public._uid();
  v_recipient uuid;
begin
  select recipient_id into v_recipient from messages where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  -- only the recipient marks a message read
  if v_recipient is distinct from v_uid then
    perform _raise('forbidden');
  end if;

  update messages
     set read_at = coalesce(read_at, now())
   where id = p_id;
end;
$$;

revoke execute on function public.mark_message_read(uuid) from public;
grant  execute on function public.mark_message_read(uuid) to authenticated;

-- Soft delete for the caller's side; the row is hard-deleted once BOTH
-- sides have deleted it.
create or replace function public.delete_message(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid := public._uid();
  v_sender    uuid;
  v_recipient uuid;
  v_sdel      boolean;
  v_rdel      boolean;
begin
  select sender_id, recipient_id, sender_deleted, recipient_deleted
    into v_sender, v_recipient, v_sdel, v_rdel
    from messages where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  if v_uid = v_sender then
    v_sdel := true;
  elsif v_uid = v_recipient then
    v_rdel := true;
  else
    perform _raise('forbidden');
  end if;

  if v_sdel and v_rdel then
    delete from messages where id = p_id;
  else
    update messages
       set sender_deleted    = v_sdel,
           recipient_deleted = v_rdel
     where id = p_id;
  end if;
end;
$$;

revoke execute on function public.delete_message(uuid) from public;
grant  execute on function public.delete_message(uuid) to authenticated;

-- Unread badge count. NEVER raises: returns 0 when logged out, so it is
-- granted to anon as well (the client polls it regardless of session).
create or replace function public.unread_count()
returns integer
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when auth.uid() is null then 0
    else (
      select count(*)::integer
        from public.messages m
       where m.recipient_id = auth.uid()
         and m.read_at is null
         and not m.recipient_deleted
    )
  end;
$$;

revoke execute on function public.unread_count() from public;
grant  execute on function public.unread_count() to anon, authenticated;

-- ============================================================
-- Likes / view counts
-- ============================================================

create or replace function public.toggle_post_like(
  p_post_id uuid
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
  if not exists (select 1 from posts where id = p_post_id) then
    perform _raise('not_found');
  end if;

  perform _check_rate('toggle_like', 30, interval '10 minutes');

  delete from post_likes where post_id = p_post_id and user_id = v_uid;
  if found then
    v_liked := false;
  else
    insert into post_likes (post_id, user_id)
    values (p_post_id, v_uid)
    on conflict (post_id, user_id) do nothing;
    v_liked := true;
  end if;

  select count(*)::integer into v_count
    from post_likes where post_id = p_post_id;

  return json_build_object('liked', v_liked, 'like_count', v_count);
end;
$$;

revoke execute on function public.toggle_post_like(uuid) from public;
grant  execute on function public.toggle_post_like(uuid) to authenticated;

-- Public view counter (anon + authenticated). Per-caller rate limit of
-- 3 / minute per target id blunts refresh-spam; hitting the limit is a
-- silent no-op — increment_view must NEVER error the client for that.
create or replace function public.increment_view(
  p_kind text,
  p_id   uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text := trim(coalesce(p_kind, ''));
begin
  if v_kind not in ('post', 'item') or p_id is null then
    perform _raise('invalid_input');
  end if;

  begin
    perform _check_rate('view:' || p_id::text, 3, interval '1 minute');
  exception when others then
    if sqlerrm = 'rate_limited' then
      return;  -- swallow: refresh-spam becomes a no-op, never an error
    end if;
    raise;
  end;

  -- silently no-op when the row is gone
  if v_kind = 'post' then
    update posts set view_count = view_count + 1 where id = p_id;
  else
    update items set view_count = view_count + 1 where id = p_id;
  end if;
end;
$$;

revoke execute on function public.increment_view(text, uuid) from public;
grant  execute on function public.increment_view(text, uuid) to anon, authenticated;

-- ============================================================
-- Lock down helpers (belt and braces, same as 03)
-- ============================================================

revoke execute on function public._send_message(uuid, uuid, text, text, uuid, text)
  from public, anon, authenticated;

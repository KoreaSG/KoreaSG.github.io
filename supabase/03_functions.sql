-- ============================================================
-- 03_functions.sql — RPC functions (the only write surface)
-- Idempotent: safe to re-run. Run AFTER 02_security.sql.
--
-- Auth model: Supabase Auth accounts. auth.uid() identifies the caller;
-- ownership lives in <table>.user_id, profile data in public.profiles.
--
-- All public RPCs: security definer, search_path = public, extensions,
-- per-function revoke from public + explicit grant right after each
-- definition. Helper functions (prefixed _) get NO grant — callable
-- only via the RPCs.
--
-- Machine-readable error messages (client maps them to Korean):
--   auth_required, forbidden, not_found, invalid_input, rate_limited
-- ============================================================

-- ============================================================
-- Drop the ENTIRE old password-based API (all old signatures),
-- so no legacy entry point survives on the live database.
-- ============================================================

drop function if exists public.create_item(text, text, integer, text, text, text[], text);
drop function if exists public.update_item(uuid, text, text, text, integer, text, text[], text);
drop function if exists public.delete_item(uuid, text);
drop function if exists public.verify_item_password(uuid, text);
drop function if exists public.add_item_comment(uuid, text, text, text, text);
drop function if exists public.delete_item_comment(uuid, text);
drop function if exists public.create_post(text, text, text, text, text);
drop function if exists public.update_post(uuid, text, text, text);
drop function if exists public.delete_post(uuid, text);
drop function if exists public.verify_post_password(uuid, text);
drop function if exists public.add_post_comment(uuid, text, text, text, text);
drop function if exists public.delete_post_comment(uuid, text);

-- old password helpers
drop function if exists public._check_password_format(text);
drop function if exists public._hash_pw(text);
drop function if exists public._verify_pw(text, text);
drop function if exists public._verify_password_guarded(uuid, text, text);
drop function if exists public._assert_fail_limit(text);

-- ============================================================
-- Private helpers (no grants — see revokes at end of file)
-- ============================================================

create or replace function public._raise(p_msg text)
returns void
language plpgsql
as $$
begin
  raise exception using message = p_msg, errcode = 'P0001';
end;
$$;

-- Caller's auth.uid(), or raise auth_required.
create or replace function public._uid()
returns uuid
language plpgsql
stable
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using message = 'auth_required', errcode = 'P0001';
  end if;
  return v_uid;
end;
$$;

create or replace function public._is_admin(p uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select is_admin from public.profiles where id = p),
    false
  );
$$;

create or replace function public._client_ip()
returns text
language plpgsql
stable
as $$
declare
  v text;
begin
  begin
    v := trim(split_part(
           coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
           ',', 1));
  exception when others then
    v := '';
  end;
  if v is null or v = '' then
    return 'unknown';
  end if;
  return v;
end;
$$;

-- Rate events are keyed by user id when logged in (IP is the fallback
-- for the rare unauthenticated code path).
create or replace function public._log_event(p_action text)
returns void
language plpgsql
as $$
declare
  v_key text := coalesce(auth.uid()::text, public._client_ip());
begin
  insert into rate_events (ip, action) values (v_key, p_action);
end;
$$;

-- Count events for (user-or-ip, action) in window; raise rate_limited
-- at the limit; otherwise record this event. Opportunistic cleanup of
-- day-old events.
create or replace function public._check_rate(p_action text, p_limit int, p_window interval)
returns void
language plpgsql
as $$
declare
  v_key   text := coalesce(auth.uid()::text, public._client_ip());
  v_count int;
begin
  if random() < 0.05 then
    delete from rate_events where created_at < now() - interval '1 day';
  end if;

  select count(*) into v_count
    from rate_events
   where ip = v_key
     and action = p_action
     and created_at > now() - p_window;

  if v_count >= p_limit then
    raise exception using message = 'rate_limited', errcode = 'P0001';
  end if;

  insert into rate_events (ip, action) values (v_key, p_action);
end;
$$;

create or replace function public._check_category(p text)
returns void
language plpgsql
as $$
begin
  if p is null or not (p = any (array[
    '디지털/가전',
    '가구/인테리어',
    '생활/주방',
    '유아동/장난감',
    '여성패션/잡화',
    '남성패션/잡화',
    '도서/취미/게임',
    '스포츠/레저/골프',
    '뷰티/미용',
    '식품/건강',
    '티켓/상품권',
    '이사/떠나요 세일',
    '기타'
  ])) then
    raise exception using message = 'invalid_input', errcode = 'P0001';
  end if;
end;
$$;

-- ============================================================
-- Items
-- ============================================================

create or replace function public.create_item(
  p_title       text,
  p_category    text,
  p_price       integer,
  p_description text,
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
  if coalesce(array_length(v_paths, 1), 0) > 8 then
    perform _raise('invalid_input');
  end if;

  perform _check_rate('create_item', 5, interval '10 minutes');

  insert into items (title, category, price, description, image_paths, user_id)
  values (v_title, v_category, p_price, v_description, v_paths, v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_item(text, text, integer, text, text[]) from public;
grant  execute on function public.create_item(text, text, integer, text, text[]) to authenticated;

create or replace function public.update_item(
  p_id          uuid,
  p_title       text,
  p_category    text,
  p_price       integer,
  p_description text,
  p_image_paths text[],
  p_status      text
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
         image_paths = v_paths,
         status      = v_status,
         updated_at  = now()
   where id = p_id;
end;
$$;

revoke execute on function public.update_item(uuid, text, text, integer, text, text[], text) from public;
grant  execute on function public.update_item(uuid, text, text, integer, text, text[], text) to authenticated;

create or replace function public.delete_item(
  p_id uuid
) returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := public._uid();
  v_owner uuid;
  v_paths text[];
begin
  select user_id, image_paths into v_owner, v_paths from items where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  -- owner or admin
  if v_owner is distinct from v_uid and not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  delete from items where id = p_id;  -- comments cascade

  -- Storage cleanup happens client-side via the Storage API with the returned
  -- paths: Supabase blocks direct deletes on storage.objects from SQL
  -- ("Use the Storage API instead").
  return coalesce(v_paths, '{}');
end;
$$;

revoke execute on function public.delete_item(uuid) from public;
grant  execute on function public.delete_item(uuid) to authenticated;

create or replace function public.add_item_comment(
  p_item_id uuid,
  p_content text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := public._uid();
  v_content text := trim(coalesce(p_content, ''));
  v_id      uuid;
begin
  if not exists (select 1 from items where id = p_item_id) then
    perform _raise('not_found');
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 1000 then
    perform _raise('invalid_input');
  end if;

  perform _check_rate('add_comment', 10, interval '10 minutes');

  insert into item_comments (item_id, content, user_id, author_name)
  values (p_item_id, v_content, v_uid, null)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_item_comment(uuid, text) from public;
grant  execute on function public.add_item_comment(uuid, text) to authenticated;

create or replace function public.delete_item_comment(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid        uuid := public._uid();
  v_author     uuid;
  v_item_id    uuid;
  v_item_owner uuid;
begin
  select user_id, item_id into v_author, v_item_id
    from item_comments where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  select user_id into v_item_owner from items where id = v_item_id;

  -- comment author OR the item's owner (moderation) OR admin
  if v_author is distinct from v_uid
     and v_item_owner is distinct from v_uid
     and not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  delete from item_comments where id = p_id;
end;
$$;

revoke execute on function public.delete_item_comment(uuid) from public;
grant  execute on function public.delete_item_comment(uuid) to authenticated;

-- ============================================================
-- Posts
-- ============================================================

create or replace function public.create_post(
  p_title        text,
  p_content      text,
  p_is_anonymous boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid    := public._uid();
  v_title   text    := trim(coalesce(p_title, ''));
  v_content text    := trim(coalesce(p_content, ''));
  v_anon    boolean := coalesce(p_is_anonymous, false);
  v_id      uuid;
begin
  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 20000 then
    perform _raise('invalid_input');
  end if;

  perform _check_rate('create_post', 5, interval '10 minutes');

  insert into posts (title, content, is_anonymous, user_id, author_name)
  values (v_title, v_content, v_anon, v_uid, null)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_post(text, text, boolean) from public;
grant  execute on function public.create_post(text, text, boolean) to authenticated;

create or replace function public.update_post(
  p_id           uuid,
  p_title        text,
  p_content      text,
  p_is_anonymous boolean
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid    := public._uid();
  v_owner   uuid;
  v_title   text    := trim(coalesce(p_title, ''));
  v_content text    := trim(coalesce(p_content, ''));
  v_anon    boolean := coalesce(p_is_anonymous, false);
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

  update posts
     set title        = v_title,
         content      = v_content,
         is_anonymous = v_anon,
         updated_at   = now()
   where id = p_id;
end;
$$;

revoke execute on function public.update_post(uuid, text, text, boolean) from public;
grant  execute on function public.update_post(uuid, text, text, boolean) to authenticated;

create or replace function public.delete_post(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := public._uid();
  v_owner uuid;
begin
  select user_id into v_owner from posts where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  -- owner or admin
  if v_owner is distinct from v_uid and not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  delete from posts where id = p_id;  -- comments cascade
end;
$$;

revoke execute on function public.delete_post(uuid) from public;
grant  execute on function public.delete_post(uuid) to authenticated;

create or replace function public.add_post_comment(
  p_post_id      uuid,
  p_content      text,
  p_is_anonymous boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid    := public._uid();
  v_content text    := trim(coalesce(p_content, ''));
  v_anon    boolean := coalesce(p_is_anonymous, false);
  v_id      uuid;
begin
  if not exists (select 1 from posts where id = p_post_id) then
    perform _raise('not_found');
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 1000 then
    perform _raise('invalid_input');
  end if;

  perform _check_rate('add_comment', 10, interval '10 minutes');

  insert into post_comments (post_id, content, is_anonymous, user_id, author_name)
  values (p_post_id, v_content, v_anon, v_uid, null)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_post_comment(uuid, text, boolean) from public;
grant  execute on function public.add_post_comment(uuid, text, boolean) to authenticated;

create or replace function public.delete_post_comment(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := public._uid();
  v_author uuid;
begin
  select user_id into v_author from post_comments where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  -- comment author or admin
  if v_author is distinct from v_uid and not public._is_admin(v_uid) then
    perform _raise('forbidden');
  end if;

  delete from post_comments where id = p_id;
end;
$$;

revoke execute on function public.delete_post_comment(uuid) from public;
grant  execute on function public.delete_post_comment(uuid) to authenticated;

-- ============================================================
-- Accounts / profiles
-- ============================================================

create or replace function public.username_available(
  p_username text
) returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(p_username, '') ~ '^[a-z0-9_]{3,20}$'
     and not exists (
       select 1 from public.profiles pr
        where lower(pr.username) = lower(p_username)
     );
$$;

revoke execute on function public.username_available(text) from public;
grant  execute on function public.username_available(text) to anon, authenticated;

-- Returns {id, username, region, is_admin} of the caller, or SQL null
-- (never raises) when not logged in.
create or replace function public.get_my_profile()
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when auth.uid() is null then null::json
    else (
      select json_build_object(
               'id',       pr.id,
               'username', pr.username,
               'region',   pr.region,
               'is_admin', pr.is_admin
             )
        from public.profiles pr
       where pr.id = auth.uid()
    )
  end;
$$;

revoke execute on function public.get_my_profile() from public;
grant  execute on function public.get_my_profile() to anon, authenticated;

-- ============================================================
-- Lock down helpers (belt and braces: 02 already revoked defaults,
-- but keep this file self-sufficient if run standalone)
-- ============================================================

revoke execute on function public._raise(text)                      from public, anon, authenticated;
revoke execute on function public._uid()                            from public, anon, authenticated;
revoke execute on function public._is_admin(uuid)                   from public, anon, authenticated;
revoke execute on function public._client_ip()                      from public, anon, authenticated;
revoke execute on function public._log_event(text)                  from public, anon, authenticated;
revoke execute on function public._check_rate(text, int, interval)  from public, anon, authenticated;
revoke execute on function public._check_category(text)             from public, anon, authenticated;
revoke execute on function public.handle_new_user()                 from public, anon, authenticated;

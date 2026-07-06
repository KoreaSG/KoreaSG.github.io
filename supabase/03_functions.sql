-- ============================================================
-- 03_functions.sql — RPC functions (the only write surface)
-- Idempotent: safe to re-run. Run AFTER 02_security.sql.
--
-- All public RPCs: security definer, search_path = public, extensions,
-- granted to anon + authenticated right after each definition.
-- Helper functions (prefixed _) get NO grant — callable only via RPCs.
--
-- Machine-readable error messages (client maps them to Korean):
--   wrong_password, rate_limited, not_found, invalid_input,
--   invalid_password_format
-- ============================================================

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

create or replace function public._check_password_format(p text)
returns void
language plpgsql
as $$
begin
  if p is null or p !~ '^\d{4}$' then
    raise exception using message = 'invalid_password_format', errcode = 'P0001';
  end if;
end;
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

create or replace function public._log_event(p_action text)
returns void
language plpgsql
as $$
begin
  insert into rate_events (ip, action) values (public._client_ip(), p_action);
end;
$$;

-- Count events for (ip, action) in window; raise rate_limited at the limit;
-- otherwise record this event. Opportunistic cleanup of day-old events.
create or replace function public._check_rate(p_action text, p_limit int, p_window interval)
returns void
language plpgsql
as $$
declare
  v_ip    text := public._client_ip();
  v_count int;
begin
  if random() < 0.05 then
    delete from rate_events where created_at < now() - interval '1 day';
  end if;

  select count(*) into v_count
    from rate_events
   where ip = v_ip
     and action = p_action
     and created_at > now() - p_window;

  if v_count >= p_limit then
    raise exception using message = 'rate_limited', errcode = 'P0001';
  end if;

  insert into rate_events (ip, action) values (v_ip, p_action);
end;
$$;

-- Count-only variant for password failures: 8 fails / 15 min / IP / target.
-- (Checked BEFORE verifying; a fail event is logged only AFTER a failed verify,
--  so successful password ops never consume the budget.)
create or replace function public._assert_fail_limit(p_action text)
returns void
language plpgsql
as $$
declare
  v_count int;
begin
  select count(*) into v_count
    from rate_events
   where ip = public._client_ip()
     and action = p_action
     and created_at > now() - interval '15 minutes';

  if v_count >= 8 then
    raise exception using message = 'rate_limited', errcode = 'P0001';
  end if;
end;
$$;

create or replace function public._hash_pw(p text)
returns text
language sql
volatile
as $$
  select crypt(p, gen_salt('bf', 8));
$$;

create or replace function public._verify_pw(p text, hash text)
returns boolean
language sql
stable
as $$
  select crypt(p, hash) = hash;
$$;

-- Full guarded verification against a single hash:
-- format check -> fail-rate check -> verify -> (log fail + wrong_password).
create or replace function public._verify_password_guarded(p_id uuid, p_password text, p_hash text)
returns void
language plpgsql
as $$
declare
  v_action text := 'fail_pw:' || p_id::text;
begin
  perform public._check_password_format(p_password);
  perform public._assert_fail_limit(v_action);
  if not public._verify_pw(p_password, p_hash) then
    perform public._log_event(v_action);
    perform public._raise('wrong_password');
  end if;
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
  p_password    text,
  p_image_paths text[] default '{}',
  p_website     text   default ''
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_title       text   := trim(coalesce(p_title, ''));
  v_category    text   := trim(coalesce(p_category, ''));
  v_description text   := trim(coalesce(p_description, ''));
  v_paths       text[] := coalesce(p_image_paths, '{}');
  v_id          uuid;
begin
  -- honeypot: fake success, no insert
  if coalesce(p_website, '') <> '' then
    return gen_random_uuid();
  end if;

  perform _check_password_format(p_password);

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

  insert into items (title, category, price, description, image_paths, password_hash)
  values (v_title, v_category, p_price, v_description, v_paths, _hash_pw(p_password))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_item(text, text, integer, text, text, text[], text) from public;
grant  execute on function public.create_item(text, text, integer, text, text, text[], text) to anon, authenticated;

create or replace function public.update_item(
  p_id          uuid,
  p_password    text,
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
  v_hash        text;
  v_title       text   := trim(coalesce(p_title, ''));
  v_category    text   := trim(coalesce(p_category, ''));
  v_description text   := trim(coalesce(p_description, ''));
  v_paths       text[] := coalesce(p_image_paths, '{}');
  v_status      text   := trim(coalesce(p_status, ''));
begin
  select password_hash into v_hash from items where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  perform _verify_password_guarded(p_id, p_password, v_hash);

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

revoke execute on function public.update_item(uuid, text, text, text, integer, text, text[], text) from public;
grant  execute on function public.update_item(uuid, text, text, text, integer, text, text[], text) to anon, authenticated;

create or replace function public.delete_item(
  p_id       uuid,
  p_password text
) returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_paths text[];
begin
  select password_hash, image_paths into v_hash, v_paths from items where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  perform _verify_password_guarded(p_id, p_password, v_hash);

  delete from items where id = p_id;  -- comments cascade

  -- Storage cleanup happens client-side via the Storage API with the returned
  -- paths: Supabase blocks direct deletes on storage.objects from SQL
  -- ("Use the Storage API instead").
  return coalesce(v_paths, '{}');
end;
$$;

revoke execute on function public.delete_item(uuid, text) from public;
grant  execute on function public.delete_item(uuid, text) to anon, authenticated;

create or replace function public.verify_item_password(
  p_id       uuid,
  p_password text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from items where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  perform _verify_password_guarded(p_id, p_password, v_hash);
  return true;
end;
$$;

revoke execute on function public.verify_item_password(uuid, text) from public;
grant  execute on function public.verify_item_password(uuid, text) to anon, authenticated;

create or replace function public.add_item_comment(
  p_item_id     uuid,
  p_author_name text,
  p_content     text,
  p_password    text default null,
  p_website     text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_author   text := trim(coalesce(p_author_name, ''));
  v_content  text := trim(coalesce(p_content, ''));
  v_password text := nullif(trim(coalesce(p_password, '')), '');
  v_hash     text := null;
  v_id       uuid;
begin
  -- honeypot: fake success, no insert
  if coalesce(p_website, '') <> '' then
    return gen_random_uuid();
  end if;

  if not exists (select 1 from items where id = p_item_id) then
    perform _raise('not_found');
  end if;

  if char_length(v_author) < 1 or char_length(v_author) > 30 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 1000 then
    perform _raise('invalid_input');
  end if;

  if v_password is not null then
    perform _check_password_format(v_password);
    v_hash := _hash_pw(v_password);
  end if;

  perform _check_rate('add_comment', 10, interval '10 minutes');

  insert into item_comments (item_id, author_name, content, password_hash)
  values (p_item_id, v_author, v_content, v_hash)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_item_comment(uuid, text, text, text, text) from public;
grant  execute on function public.add_item_comment(uuid, text, text, text, text) to anon, authenticated;

create or replace function public.delete_item_comment(
  p_id       uuid,
  p_password text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_chash   text;
  v_item_id uuid;
  v_ihash   text;
  v_action  text := 'fail_pw:' || p_id::text;
  v_ok      boolean := false;
begin
  select password_hash, item_id into v_chash, v_item_id
    from item_comments where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  select password_hash into v_ihash from items where id = v_item_id;

  perform _check_password_format(p_password);
  perform _assert_fail_limit(v_action);

  -- comment's own password OR parent item's password (owner moderation);
  -- if the comment has no password, only the item's password works.
  if v_chash is not null and _verify_pw(p_password, v_chash) then
    v_ok := true;
  elsif v_ihash is not null and _verify_pw(p_password, v_ihash) then
    v_ok := true;
  end if;

  if not v_ok then
    perform _log_event(v_action);
    perform _raise('wrong_password');
  end if;

  delete from item_comments where id = p_id;
end;
$$;

revoke execute on function public.delete_item_comment(uuid, text) from public;
grant  execute on function public.delete_item_comment(uuid, text) to anon, authenticated;

-- ============================================================
-- Posts
-- ============================================================

create or replace function public.create_post(
  p_title       text,
  p_content     text,
  p_password    text,
  p_author_name text default '익명',
  p_website     text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_title   text := trim(coalesce(p_title, ''));
  v_content text := trim(coalesce(p_content, ''));
  v_author  text := trim(coalesce(p_author_name, ''));
  v_id      uuid;
begin
  -- honeypot: fake success, no insert
  if coalesce(p_website, '') <> '' then
    return gen_random_uuid();
  end if;

  perform _check_password_format(p_password);

  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 20000 then
    perform _raise('invalid_input');
  end if;
  if v_author = '' then
    v_author := '익명';
  end if;
  if char_length(v_author) > 30 then
    perform _raise('invalid_input');
  end if;

  perform _check_rate('create_post', 5, interval '10 minutes');

  insert into posts (title, content, author_name, password_hash)
  values (v_title, v_content, v_author, _hash_pw(p_password))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_post(text, text, text, text, text) from public;
grant  execute on function public.create_post(text, text, text, text, text) to anon, authenticated;

create or replace function public.update_post(
  p_id       uuid,
  p_password text,
  p_title    text,
  p_content  text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash    text;
  v_title   text := trim(coalesce(p_title, ''));
  v_content text := trim(coalesce(p_content, ''));
begin
  select password_hash into v_hash from posts where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  perform _verify_password_guarded(p_id, p_password, v_hash);

  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 20000 then
    perform _raise('invalid_input');
  end if;

  update posts
     set title      = v_title,
         content    = v_content,
         updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.update_post(uuid, text, text, text) from public;
grant  execute on function public.update_post(uuid, text, text, text) to anon, authenticated;

create or replace function public.delete_post(
  p_id       uuid,
  p_password text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from posts where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  perform _verify_password_guarded(p_id, p_password, v_hash);

  delete from posts where id = p_id;  -- comments cascade
end;
$$;

revoke execute on function public.delete_post(uuid, text) from public;
grant  execute on function public.delete_post(uuid, text) to anon, authenticated;

create or replace function public.verify_post_password(
  p_id       uuid,
  p_password text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from posts where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  perform _verify_password_guarded(p_id, p_password, v_hash);
  return true;
end;
$$;

revoke execute on function public.verify_post_password(uuid, text) from public;
grant  execute on function public.verify_post_password(uuid, text) to anon, authenticated;

create or replace function public.add_post_comment(
  p_post_id     uuid,
  p_author_name text,
  p_content     text,
  p_password    text default null,
  p_website     text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_author   text := trim(coalesce(p_author_name, ''));
  v_content  text := trim(coalesce(p_content, ''));
  v_password text := nullif(trim(coalesce(p_password, '')), '');
  v_hash     text := null;
  v_id       uuid;
begin
  -- honeypot: fake success, no insert
  if coalesce(p_website, '') <> '' then
    return gen_random_uuid();
  end if;

  if not exists (select 1 from posts where id = p_post_id) then
    perform _raise('not_found');
  end if;

  if char_length(v_author) < 1 or char_length(v_author) > 30 then
    perform _raise('invalid_input');
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 1000 then
    perform _raise('invalid_input');
  end if;

  if v_password is not null then
    perform _check_password_format(v_password);
    v_hash := _hash_pw(v_password);
  end if;

  perform _check_rate('add_comment', 10, interval '10 minutes');

  insert into post_comments (post_id, author_name, content, password_hash)
  values (p_post_id, v_author, v_content, v_hash)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_post_comment(uuid, text, text, text, text) from public;
grant  execute on function public.add_post_comment(uuid, text, text, text, text) to anon, authenticated;

create or replace function public.delete_post_comment(
  p_id       uuid,
  p_password text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_chash   text;
  v_post_id uuid;
  v_phash   text;
  v_action  text := 'fail_pw:' || p_id::text;
  v_ok      boolean := false;
begin
  select password_hash, post_id into v_chash, v_post_id
    from post_comments where id = p_id;
  if not found then
    perform _raise('not_found');
  end if;

  select password_hash into v_phash from posts where id = v_post_id;

  perform _check_password_format(p_password);
  perform _assert_fail_limit(v_action);

  -- comment's own password OR parent post's password (owner moderation);
  -- if the comment has no password, only the post's password works.
  if v_chash is not null and _verify_pw(p_password, v_chash) then
    v_ok := true;
  elsif v_phash is not null and _verify_pw(p_password, v_phash) then
    v_ok := true;
  end if;

  if not v_ok then
    perform _log_event(v_action);
    perform _raise('wrong_password');
  end if;

  delete from post_comments where id = p_id;
end;
$$;

revoke execute on function public.delete_post_comment(uuid, text) from public;
grant  execute on function public.delete_post_comment(uuid, text) to anon, authenticated;

-- ============================================================
-- Lock down helpers (belt and braces: 02 already revoked defaults,
-- but keep this file self-sufficient if run standalone)
-- ============================================================

revoke execute on function public._raise(text)                                     from public, anon, authenticated;
revoke execute on function public._check_password_format(text)                     from public, anon, authenticated;
revoke execute on function public._client_ip()                                     from public, anon, authenticated;
revoke execute on function public._log_event(text)                                 from public, anon, authenticated;
revoke execute on function public._check_rate(text, int, interval)                 from public, anon, authenticated;
revoke execute on function public._assert_fail_limit(text)                         from public, anon, authenticated;
revoke execute on function public._hash_pw(text)                                   from public, anon, authenticated;
revoke execute on function public._verify_pw(text, text)                           from public, anon, authenticated;
revoke execute on function public._verify_password_guarded(uuid, text, text)       from public, anon, authenticated;
revoke execute on function public._check_category(text)                            from public, anon, authenticated;

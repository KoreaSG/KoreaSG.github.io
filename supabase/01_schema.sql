-- ============================================================
-- 01_schema.sql — extensions, tables, auth trigger, indexes, views
-- SGcommunity (Singapore Koreans community) — Supabase free tier
-- Idempotent: safe to re-run, including on a live database that
-- still has the old 4-digit-password schema (the migration block
-- below upgrades it in place).
-- Run order: 01 -> 02 -> 03 -> 04
-- ============================================================

-- ---------- extensions ----------
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ---------- tables ----------

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 100),
  category    text not null,
  price       integer not null check (price >= 0 and price <= 1000000),
  description text not null default '' check (char_length(description) <= 5000),
  image_paths text[] not null default '{}'
              check (array_length(image_paths, 1) is null or array_length(image_paths, 1) <= 8),
  status      text not null default 'selling' check (status in ('selling', 'reserved', 'sold')),
  user_id     uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.item_comments (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  author_name text check (char_length(author_name) between 1 and 30),  -- legacy (pre-auth rows only)
  content     text not null check (char_length(content) between 1 and 1000),
  user_id     uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 100),
  content      text not null check (char_length(content) between 1 and 20000),
  author_name  text default '익명' check (char_length(author_name) <= 30),  -- legacy (pre-auth rows only)
  is_anonymous boolean not null default false,
  user_id      uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.post_comments (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  author_name  text check (char_length(author_name) between 1 and 30),  -- legacy (pre-auth rows only)
  content      text not null check (char_length(content) between 1 and 1000),
  is_anonymous boolean not null default false,
  user_id      uuid,
  created_at   timestamptz not null default now()
);

create table if not exists public.rate_events (
  id         bigint generated always as identity primary key,
  ip         text not null,
  action     text not null,
  created_at timestamptz not null default now()
);

-- One profile per Supabase Auth user, created by the signup trigger below.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null check (username ~ '^[a-z0-9_]{3,20}$'),
  region     text not null check (region in (
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
  )),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- ---------- auth signup trigger ----------
-- Creates the profile row from raw_user_meta_data keys 'username' and
-- 'region'. A raise here aborts the signup — intended: an invalid
-- signup must not create an auth user without a profile.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_region   text := trim(coalesce(new.raw_user_meta_data ->> 'region', ''));
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_username: username must match ^[a-z0-9_]{3,20}$';
  end if;

  if v_region not in (
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
  ) then
    raise exception 'invalid_region: unknown region "%"', v_region;
  end if;

  if exists (
    select 1 from public.profiles pr where lower(pr.username) = v_username
  ) then
    raise exception 'username_taken: "%" is already in use', v_username;
  end if;

  insert into public.profiles (id, username, region)
  values (new.id, v_username, v_region);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- migration: 4-digit-password auth -> Supabase Auth ----------
-- The old views reference password_hash, so drop them BEFORE the column
-- drops (they are recreated with the new column sets at the end of this
-- file — 'create or replace view' cannot remove columns anyway).

drop view if exists public.items_view;
drop view if exists public.item_comments_view;
drop view if exists public.posts_view;
drop view if exists public.post_comments_view;

alter table public.posts         add column if not exists is_anonymous boolean not null default false;
alter table public.post_comments add column if not exists is_anonymous boolean not null default false;

alter table public.items         drop column if exists password_hash;
alter table public.item_comments drop column if exists password_hash;
alter table public.posts         drop column if exists password_hash;
alter table public.post_comments drop column if exists password_hash;

-- author_name stays (legacy display fallback) but becomes nullable.
do $$
begin
  alter table public.item_comments alter column author_name drop not null;
exception when others then null;  -- already nullable
end;
$$;

do $$
begin
  alter table public.posts alter column author_name drop not null;
exception when others then null;  -- already nullable
end;
$$;

do $$
begin
  alter table public.post_comments alter column author_name drop not null;
exception when others then null;  -- already nullable
end;
$$;

-- ---------- indexes ----------

create index if not exists items_created_at_idx
  on public.items (created_at desc);

create index if not exists items_category_created_at_idx
  on public.items (category, created_at desc);

create index if not exists items_title_trgm_idx
  on public.items using gin (title extensions.gin_trgm_ops);

create index if not exists item_comments_item_id_created_at_idx
  on public.item_comments (item_id, created_at);

create index if not exists posts_created_at_idx
  on public.posts (created_at desc);

create index if not exists posts_title_trgm_idx
  on public.posts using gin (title extensions.gin_trgm_ops);

create index if not exists post_comments_post_id_created_at_idx
  on public.post_comments (post_id, created_at);

create index if not exists rate_events_ip_action_created_at_idx
  on public.rate_events (ip, action, created_at desc);

-- ---------- v3 forward-compat (owned by 05_messages_likes.sql) ----------
-- posts_view / items_view below reference post_likes and view_count,
-- which 05_messages_likes.sql creates — but this file re-runs BEFORE 05
-- on the live database, so ensure they exist first (identical idempotent
-- DDL; 05 re-running it is a no-op).

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);

alter table public.posts add column if not exists view_count integer not null default 0;
alter table public.items add column if not exists view_count integer not null default 0;

-- ---------- v4 forward-compat (owned by 06_v4.sql) ----------
-- posts_view / items_view below reference the communities table, the
-- item_likes table, and the community_id / image_paths / location columns,
-- which 06_v4.sql creates — but this file re-runs BEFORE 06 on the live
-- database, so ensure they exist first (identical idempotent DDL; 06
-- re-running it is a no-op).

create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null check (slug ~ '^[a-z0-9-]{2,30}$'),
  name        text not null check (char_length(name) between 1 and 30),
  description text not null default '',
  sort_order  int not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.posts add column if not exists community_id uuid references public.communities(id);
alter table public.posts add column if not exists image_paths text[] not null default '{}'
  check (array_length(image_paths, 1) is null or array_length(image_paths, 1) <= 8);
alter table public.items add column if not exists location text;

create table if not exists public.item_likes (
  item_id    uuid not null references public.items(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (item_id, user_id)
);

-- ---------- views ----------
-- Views run as owner (security_invoker = off, the default) so they can
-- read the RLS-locked tables, but auth.uid() still reads the request
-- JWT, so is_mine works per-request. The client reads ONLY these views
-- (never the tables). NEVER expose user_id, and never expose the
-- username on anonymous rows.
-- (Dropped above, before the password_hash column drops.)

create view public.items_view as
select
  i.id,
  i.title,
  i.category,
  i.price,
  i.description,
  i.image_paths,
  i.status,
  i.location,
  i.view_count,
  i.created_at,
  i.updated_at,
  (select count(*) from public.item_comments c where c.item_id = i.id) as comment_count,
  (select count(*) from public.item_likes il where il.item_id = i.id) as like_count,
  (
    (select count(*) from public.item_comments c where c.item_id = i.id)
    + (select count(*) from public.item_likes il where il.item_id = i.id)
  ) as popularity,
  (auth.uid() is not null and exists (
    select 1 from public.item_likes il
     where il.item_id = i.id and il.user_id = auth.uid()
  )) as liked_by_me_item,
  pr.username as seller_username,
  pr.region   as seller_region,
  (auth.uid() is not null and auth.uid() = i.user_id) as is_mine
from public.items i
left join public.profiles pr on pr.id = i.user_id;

create view public.item_comments_view as
select
  c.id,
  c.item_id,
  pr.username as author_username,
  c.content,
  c.created_at,
  (auth.uid() is not null and auth.uid() = c.user_id) as is_mine
from public.item_comments c
left join public.profiles pr on pr.id = c.user_id;

create view public.posts_view as
select
  p.id,
  p.title,
  p.content,
  p.is_anonymous,
  case
    when p.is_anonymous then '익명'
    else coalesce(pr.username, p.author_name, '익명')
  end as author_display,
  p.community_id,
  co.name as community_name,
  p.image_paths,
  (coalesce(array_length(p.image_paths, 1), 0) > 0) as has_image,
  p.created_at,
  p.updated_at,
  (select count(*) from public.post_comments c where c.post_id = p.id) as comment_count,
  (select count(*) from public.post_likes pl where pl.post_id = p.id) as like_count,
  (select count(*) from public.post_likes pl
    where pl.post_id = p.id
      and pl.created_at > now() - interval '7 days') as recent_like_count,
  p.view_count,
  (auth.uid() is not null and exists (
    select 1 from public.post_likes pl
     where pl.post_id = p.id and pl.user_id = auth.uid()
  )) as liked_by_me,
  (auth.uid() is not null and auth.uid() = p.user_id) as is_mine
from public.posts p
left join public.profiles pr on pr.id = p.user_id
left join public.communities co on co.id = p.community_id;

create view public.post_comments_view as
select
  c.id,
  c.post_id,
  c.is_anonymous,
  case
    when c.is_anonymous then '익명'
    else coalesce(pr.username, c.author_name, '익명')
  end as author_display,
  c.content,
  c.created_at,
  (auth.uid() is not null and auth.uid() = c.user_id) as is_mine
from public.post_comments c
left join public.profiles pr on pr.id = c.user_id;

-- ============================================================
-- 01_schema.sql — extensions, tables, indexes, views
-- SGcommunity (Singapore Koreans community) — Supabase free tier
-- Idempotent: safe to re-run.
-- Run order: 01 -> 02 -> 03 -> 04
-- ============================================================

-- ---------- extensions ----------
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ---------- tables ----------

create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 100),
  category      text not null,
  price         integer not null check (price >= 0 and price <= 1000000),
  description   text not null default '' check (char_length(description) <= 5000),
  image_paths   text[] not null default '{}'
                check (array_length(image_paths, 1) is null or array_length(image_paths, 1) <= 8),
  status        text not null default 'selling' check (status in ('selling', 'reserved', 'sold')),
  password_hash text not null,
  user_id       uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.item_comments (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items(id) on delete cascade,
  author_name   text not null check (char_length(author_name) between 1 and 30),
  content       text not null check (char_length(content) between 1 and 1000),
  password_hash text,
  user_id       uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 100),
  content       text not null check (char_length(content) between 1 and 20000),
  author_name   text not null default '익명' check (char_length(author_name) <= 30),
  password_hash text not null,
  user_id       uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.post_comments (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts(id) on delete cascade,
  author_name   text not null check (char_length(author_name) between 1 and 30),
  content       text not null check (char_length(content) between 1 and 1000),
  password_hash text,
  user_id       uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.rate_events (
  id         bigint generated always as identity primary key,
  ip         text not null,
  action     text not null,
  created_at timestamptz not null default now()
);

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

-- ---------- views ----------
-- Views run as owner (security_invoker = off, the default) so they can read
-- the RLS-locked tables. Safe: they never expose password_hash / user_id.
-- The client reads ONLY these views (never the tables).

create or replace view public.items_view as
select
  i.id,
  i.title,
  i.category,
  i.price,
  i.description,
  i.image_paths,
  i.status,
  i.created_at,
  i.updated_at,
  (select count(*) from public.item_comments c where c.item_id = i.id) as comment_count
from public.items i;

create or replace view public.item_comments_view as
select
  c.id,
  c.item_id,
  c.author_name,
  c.content,
  c.created_at,
  (c.password_hash is not null) as has_password
from public.item_comments c;

create or replace view public.posts_view as
select
  p.id,
  p.title,
  p.content,
  p.author_name,
  p.created_at,
  p.updated_at,
  (select count(*) from public.post_comments c where c.post_id = p.id) as comment_count
from public.posts p;

create or replace view public.post_comments_view as
select
  c.id,
  c.post_id,
  c.author_name,
  c.content,
  c.created_at,
  (c.password_hash is not null) as has_password
from public.post_comments c;

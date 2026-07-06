-- ============================================================
-- 02_security.sql — RLS, revokes / grants
-- Idempotent: safe to re-run.
-- NOTE: this file revokes execute on ALL functions in public,
--       so 03_functions.sql must be (re-)run AFTER this file to
--       restore the per-function grants.
-- ============================================================

-- ---------- RLS: enable on all tables, create NO policies (deny-all) ----------

alter table public.items         enable row level security;
alter table public.item_comments enable row level security;
alter table public.posts         enable row level security;
alter table public.post_comments enable row level security;
alter table public.rate_events   enable row level security;

-- ---------- table privileges ----------
-- API roles get no direct table access at all (defense in depth on top of RLS).

revoke all on all tables in schema public from anon, authenticated;

-- The 4 public views are the ONLY readable surface.

grant select on
  public.items_view,
  public.item_comments_view,
  public.posts_view,
  public.post_comments_view
to anon, authenticated;

-- ---------- function privileges ----------
-- Remove the default "execute for PUBLIC" on functions created from now on...

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- ...and on any function that already exists. Per-function grants are
-- re-issued in 03_functions.sql right after each function definition.

revoke execute on all functions in schema public from public, anon, authenticated;

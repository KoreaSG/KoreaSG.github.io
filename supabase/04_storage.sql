-- ============================================================
-- 04_storage.sql — storage bucket + policies
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- bucket: item-images (public read) ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  true,
  5242880,  -- 5 MB
  '{image/jpeg,image/png,image/webp}'
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- policies on storage.objects ----------
-- Uploads and deletes are restricted to the items/ prefix of this bucket.
-- No UPDATE policy (objects are immutable once uploaded).
-- SELECT policy is required for the delete API to find its target rows
-- (public download alone does not cover storage.objects reads).

drop policy if exists "item_images_select" on storage.objects;
create policy "item_images_select"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'item-images'
    and name like 'items/%'
  );

drop policy if exists "item_images_insert" on storage.objects;
create policy "item_images_insert"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'item-images'
    and name like 'items/%'
  );

drop policy if exists "item_images_delete" on storage.objects;
create policy "item_images_delete"
  on storage.objects
  for delete
  to anon, authenticated
  using (
    bucket_id = 'item-images'
    and name like 'items/%'
  );

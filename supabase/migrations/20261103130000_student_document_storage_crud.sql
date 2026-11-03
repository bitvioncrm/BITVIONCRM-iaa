drop policy if exists documents_object_delete on storage.objects;
create policy documents_object_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  );

drop policy if exists documents_object_update on storage.objects;
create policy documents_object_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  )
  with check (
    bucket_id = 'documents'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  );

update storage.buckets
set
  file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'documents';

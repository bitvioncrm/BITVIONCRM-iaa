drop policy if exists product_images_insert on storage.objects;
create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.workspaces w
        where w.id = split_part(storage.objects.name, '/', 2)::uuid
          and (
            public.is_org_admin(w.organization_id)
            or exists (
              select 1 from public.workspace_role_keys(w.id) k
              where k in ('doctor', 'duty_doctor', 'receptionist', 'admin')
            )
          )
      )
    )
  );

drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.workspaces w
        where w.id = split_part(storage.objects.name, '/', 2)::uuid
          and (
            public.is_org_admin(w.organization_id)
            or exists (
              select 1 from public.workspace_role_keys(w.id) k
              where k in ('doctor', 'duty_doctor', 'receptionist', 'admin')
            )
          )
      )
    )
  );

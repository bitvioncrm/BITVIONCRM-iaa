drop policy if exists inventory_clinical on public.inventory_products;
create policy inventory_clinical on public.inventory_products
for all to authenticated
using (
  deleted_at is null
  and (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.workspace_role_keys(inventory_products.workspace_id) k
      where k.k = any (array['doctor', 'duty_doctor', 'doctor_bhama', 'receptionist', 'admin'])
    )
  )
)
with check (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or exists (
    select 1 from public.workspace_role_keys(inventory_products.workspace_id) k
    where k.k = any (array['doctor', 'duty_doctor', 'doctor_bhama', 'receptionist', 'admin'])
  )
);

drop policy if exists inventory_tx_clinical on public.inventory_transactions;
create policy inventory_tx_clinical on public.inventory_transactions
for all to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or exists (
    select 1 from public.workspace_role_keys(inventory_transactions.workspace_id) k
    where k.k = any (array['doctor', 'duty_doctor', 'doctor_bhama', 'receptionist', 'admin'])
  )
)
with check (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or exists (
    select 1 from public.workspace_role_keys(inventory_transactions.workspace_id) k
    where k.k = any (array['doctor', 'duty_doctor', 'doctor_bhama', 'receptionist', 'admin'])
  )
);

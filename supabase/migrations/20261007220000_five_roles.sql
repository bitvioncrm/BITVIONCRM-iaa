-- Five working roles. Super Admin keeps the same access as Admin.
-- Clinic telecaller and institute telecaller are the calling desks.
-- WhatsApp writes, billing, and automation stay with Admin.
-- Reception has patients and appointments, and no billing or inventory.

insert into public.roles (key, name) values
  ('clinic_telecaller', 'Clinic Telecaller'),
  ('institute_telecaller', 'Institute Telecaller')
on conflict (key) do update set name = excluded.name;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('view', 'create', 'read', 'update', 'export', 'import')
where r.key in ('clinic_telecaller', 'institute_telecaller')
on conflict do nothing;

create or replace function public.can_use_institute(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (select 1 from public.workspaces w where w.id = ws and public.is_org_admin(w.organization_id))
    or exists (
      select 1 from public.workspace_role_keys(ws) k
      where k in ('institute_user', 'institute_bde', 'institute_telecaller', 'admin')
    );
$$;

drop policy if exists students_select on public.students;
drop policy if exists students_insert on public.students;
drop policy if exists students_update on public.students;

create policy students_select on public.students
  for select to authenticated
  using (
    deleted_at is null
    and public.can_use_institute(workspace_id)
    and (
      public.is_super_admin()
      or public.is_org_admin(organization_id)
      or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('admin', 'institute_bde', 'institute_telecaller'))
      or counsellor_id = auth.uid()
    )
  );

create policy students_insert on public.students
  for insert to authenticated
  with check (
    public.can_use_institute(workspace_id)
    and (
      public.is_super_admin()
      or public.is_org_admin(organization_id)
      or counsellor_id = auth.uid()
      or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('admin', 'institute_bde', 'institute_telecaller'))
    )
  );

create policy students_update on public.students
  for update to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or counsellor_id = auth.uid()
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('admin', 'institute_bde', 'institute_telecaller'))
  )
  with check (public.can_use_institute(workspace_id));

drop policy if exists consultations_rw on public.consultations;
create policy consultations_clinical on public.consultations
  for all to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  );

drop policy if exists prescriptions_rw on public.prescriptions;
create policy prescriptions_clinical on public.prescriptions
  for all to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  );

drop policy if exists inventory_rw on public.inventory_products;
create policy inventory_clinical on public.inventory_products
  for all to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  );

drop policy if exists inventory_tx_rw on public.inventory_transactions;
create policy inventory_tx_clinical on public.inventory_transactions
  for all to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  );

alter table public.inventory_transactions add column if not exists note text not null default '';

drop function if exists public.apply_stock_change(uuid, text, numeric);
create function public.apply_stock_change(product uuid, kind text, qty numeric, note text default '')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  org uuid;
  ws uuid;
  stock numeric;
begin
  select organization_id, workspace_id, current_stock into org, ws, stock
  from public.inventory_products where id = product;
  if org is null then
    raise exception 'Product not found';
  end if;
  if stock + qty < 0 then
    raise exception 'Stock cannot go below zero';
  end if;
  insert into public.inventory_transactions (organization_id, workspace_id, product_id, transaction_type, quantity, note, created_by)
  values (org, ws, product, kind, qty, coalesce(note, ''), auth.uid());
  update public.inventory_products
  set current_stock = current_stock + qty
  where id = product;
end;
$$;

grant execute on function public.apply_stock_change(uuid, text, numeric, text) to authenticated;

alter table public.admissions add column if not exists batch_id uuid references public.batches (id);
alter table public.admissions add column if not exists status text not null default 'admitted';

alter table public.certificates add column if not exists certificate_number text not null default '';
alter table public.certificates add column if not exists status text not null default 'issued';
alter table public.certificates add column if not exists storage_path text not null default '';

alter table public.documents add column if not exists verification_status text not null default 'pending';

drop policy if exists messages_rw on public.messages;
drop policy if exists messages_select on public.messages;
drop policy if exists messages_admin_write on public.messages;
drop policy if exists messages_admin_update on public.messages;

create policy messages_select on public.messages
  for select to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or lead_id in (select l.id from public.leads l where l.assigned_to = auth.uid())
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k = 'receptionist')
    or (
      exists (select 1 from public.workspace_role_keys(workspace_id) k where k = 'doctor')
      and lead_id in (
        select p.lead_id from public.patients p
        where p.lead_id is not null
          and (
            exists (select 1 from public.appointments a where a.patient_id = p.id and a.doctor_id = auth.uid())
            or exists (select 1 from public.consultations c where c.patient_id = p.id and c.doctor_id = auth.uid())
          )
      )
    )
  );

create policy messages_admin_write on public.messages
  for insert to authenticated
  with check (public.is_super_admin() or public.is_org_admin(organization_id));

create policy messages_admin_update on public.messages
  for update to authenticated
  using (public.is_super_admin() or public.is_org_admin(organization_id))
  with check (public.is_super_admin() or public.is_org_admin(organization_id));

drop policy if exists invoices_rw on public.invoices;
create policy invoices_admin on public.invoices
  for all to authenticated
  using (public.can_view_money(workspace_id))
  with check (public.can_view_money(workspace_id));

drop policy if exists payments_rw on public.payments;
create policy payments_admin on public.payments
  for all to authenticated
  using (public.can_view_money(workspace_id))
  with check (public.can_view_money(workspace_id));

drop policy if exists invoice_items_rw on public.invoice_items;
create policy invoice_items_admin on public.invoice_items
  for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_view_money(i.workspace_id)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_view_money(i.workspace_id)));

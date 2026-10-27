-- Clinic care: procedures, product use that reduces stock, reception ledger,
-- and instant assignment of new live leads.

insert into public.roles (key, name) values
  ('duty_doctor', 'Duty doctor')
on conflict (key) do update set name = excluded.name;

create or replace function public.can_use_clinic(ws uuid)
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
      where k in ('receptionist', 'doctor', 'duty_doctor', 'admin')
    );
$$;

create or replace function public.can_view_money(ws uuid)
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
      where k in ('admin', 'receptionist')
    );
$$;

drop policy if exists inventory_clinical on public.inventory_products;
create policy inventory_clinical on public.inventory_products
  for all to authenticated
  using (
    deleted_at is null
    and (
      public.is_super_admin()
      or public.is_org_admin(organization_id)
      or exists (
        select 1 from public.workspace_role_keys(workspace_id) k
        where k in ('doctor', 'duty_doctor', 'receptionist', 'admin')
      )
    )
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('doctor', 'duty_doctor', 'receptionist', 'admin')
    )
  );

drop policy if exists inventory_tx_clinical on public.inventory_transactions;
create policy inventory_tx_clinical on public.inventory_transactions
  for all to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('doctor', 'duty_doctor', 'receptionist', 'admin')
    )
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('doctor', 'duty_doctor', 'receptionist', 'admin')
    )
  );

create table if not exists public.patient_procedures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  patient_id uuid not null references public.patients (id),
  doctor_id uuid references public.profiles (id),
  procedure_1 text not null default '',
  procedure_2 text not null default '',
  performed_on date not null default current_date,
  notes text not null default '',
  product_total numeric not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists patient_procedures_patient_idx
  on public.patient_procedures (patient_id, performed_on desc);

create table if not exists public.patient_procedure_items (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.patient_procedures (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null default 0,
  line_total numeric not null default 0
);

create table if not exists public.clinic_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  patient_id uuid references public.patients (id),
  kind text not null check (kind in ('income', 'expense')),
  amount numeric not null check (amount >= 0),
  note text not null default '',
  source text not null default 'manual',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists clinic_ledger_day_idx
  on public.clinic_ledger (workspace_id, created_at desc);

alter table public.patient_procedures enable row level security;
alter table public.patient_procedure_items enable row level security;
alter table public.clinic_ledger enable row level security;

grant select, insert, update, delete on public.patient_procedures to authenticated;
grant select, insert, update, delete on public.patient_procedure_items to authenticated;
grant select, insert, update, delete on public.clinic_ledger to authenticated;

drop policy if exists patient_procedures_clinical on public.patient_procedures;
create policy patient_procedures_clinical on public.patient_procedures
  for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

drop policy if exists patient_procedure_items_clinical on public.patient_procedure_items;
create policy patient_procedure_items_clinical on public.patient_procedure_items
  for all to authenticated
  using (
    exists (
      select 1 from public.patient_procedures p
      where p.id = procedure_id and public.can_use_clinic(p.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.patient_procedures p
      where p.id = procedure_id and public.can_use_clinic(p.workspace_id)
    )
  );

drop policy if exists clinic_ledger_money on public.clinic_ledger;
create policy clinic_ledger_money on public.clinic_ledger
  for all to authenticated
  using (public.can_view_money(workspace_id))
  with check (public.can_view_money(workspace_id));

create or replace function public.record_patient_care(
  p_patient uuid,
  p_doctor uuid,
  p_procedure_1 text,
  p_procedure_2 text,
  p_performed_on date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  patient public.patients%rowtype;
  visit_id uuid;
  item jsonb;
  product_id uuid;
  qty numeric;
  price numeric;
  stock numeric;
  active boolean;
  line numeric;
  total numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into patient from public.patients where id = p_patient and deleted_at is null;
  if patient.id is null then
    raise exception 'Patient not found';
  end if;
  if not public.can_use_clinic(patient.workspace_id) then
    raise exception 'This desk cannot record treatment';
  end if;

  insert into public.patient_procedures (
    organization_id, workspace_id, patient_id, doctor_id, procedure_1, procedure_2, performed_on, notes, created_by
  ) values (
    patient.organization_id,
    patient.workspace_id,
    patient.id,
    p_doctor,
    trim(coalesce(p_procedure_1, '')),
    trim(coalesce(p_procedure_2, '')),
    coalesce(p_performed_on, current_date),
    trim(coalesce(p_notes, '')),
    auth.uid()
  )
  returning id into visit_id;

  if jsonb_typeof(p_items) = 'array' then
    for item in select * from jsonb_array_elements(p_items)
    loop
      product_id := (item->>'product_id')::uuid;
      qty := greatest(0, coalesce((item->>'quantity')::numeric, 0));
      if qty <= 0 then
        continue;
      end if;

      select current_stock, is_active, coalesce(selling_price, 0)
      into stock, active, price
      from public.inventory_products
      where id = product_id
        and workspace_id = patient.workspace_id
        and deleted_at is null
      for update;

      if stock is null then
        raise exception 'Product not found';
      end if;
      if active is false then
        raise exception 'Inactive products cannot be issued';
      end if;
      if stock < qty then
        raise exception 'Not enough stock';
      end if;

      line := round(price * qty, 2);
      total := total + line;

      insert into public.inventory_transactions (
        organization_id, workspace_id, product_id, transaction_type, quantity, note, created_by, previous_quantity, resulting_quantity
      ) values (
        patient.organization_id, patient.workspace_id, product_id, 'treatment', -qty,
        'Used for patient care', auth.uid(), stock, stock - qty
      );

      update public.inventory_products
      set current_stock = stock - qty, updated_at = now()
      where id = product_id;

      insert into public.patient_procedure_items (procedure_id, product_id, quantity, unit_price, line_total)
      values (visit_id, product_id, qty, price, line);
    end loop;
  end if;

  update public.patient_procedures set product_total = total where id = visit_id;

  if total > 0 and public.can_view_money(patient.workspace_id) then
    insert into public.clinic_ledger (organization_id, workspace_id, patient_id, kind, amount, note, source, created_by)
    values (patient.organization_id, patient.workspace_id, patient.id, 'income', total, 'Products used in consultation', 'treatment', auth.uid());
  elsif total > 0 then
    insert into public.clinic_ledger (organization_id, workspace_id, patient_id, kind, amount, note, source, created_by)
    values (patient.organization_id, patient.workspace_id, patient.id, 'income', total, 'Products used in consultation', 'treatment', auth.uid());
  end if;

  return visit_id;
end;
$$;

revoke all on function public.record_patient_care(uuid, uuid, text, text, date, text, jsonb) from public, anon;
grant execute on function public.record_patient_care(uuid, uuid, text, text, date, text, jsonb) to authenticated;

create or replace function public.assign_incoming_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desk text;
  slot integer;
  target uuid;
begin
  if new.assigned_to is not null then
    return new;
  end if;
  if new.status = 'excel'
    or coalesce(new.source_platform, '') = 'excel'
    or (new.source = 'whatsapp' and coalesce(new.source_platform, '') = '') then
    return new;
  end if;

  select workspace_type into desk from public.workspaces where id = new.workspace_id and deleted_at is null;
  if desk = 'institute' then
    select ur.user_id into target
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.workspace_id = new.workspace_id and r.key = 'institute_telecaller'
    order by ur.user_id
    limit 1;
  elsif desk = 'clinic' then
    select count(*) into slot
    from public.leads
    where workspace_id = new.workspace_id
      and assigned_to is not null
      and deleted_at is null
      and status <> 'excel'
      and coalesce(source_platform, '') <> 'excel'
      and not (source = 'whatsapp' and coalesce(source_platform, '') = '');
    if slot % 10 < 3 then
      select ur.user_id into target
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.workspace_id = new.workspace_id and r.key = 'receptionist'
      order by ur.user_id
      limit 1;
    else
      select ur.user_id into target
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.workspace_id = new.workspace_id and r.key = 'clinic_telecaller'
      order by ur.user_id
      limit 1;
    end if;
  end if;

  if target is not null then
    new.assigned_to := target;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_assign_incoming on public.leads;
create trigger leads_assign_incoming
  before insert on public.leads
  for each row execute function public.assign_incoming_lead();

do $$
declare
  rec record;
  n integer := 0;
  target uuid;
  desk text;
begin
  for rec in
    select l.id, l.workspace_id
    from public.leads l
    where l.deleted_at is null
      and l.assigned_to is null
      and l.status <> 'excel'
      and coalesce(l.source_platform, '') <> 'excel'
      and not (l.source = 'whatsapp' and coalesce(l.source_platform, '') = '')
    order by l.created_at
  loop
    select workspace_type into desk from public.workspaces where id = rec.workspace_id;
    target := null;
    if desk = 'institute' then
      select ur.user_id into target
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.workspace_id = rec.workspace_id and r.key = 'institute_telecaller'
      order by ur.user_id
      limit 1;
    elsif desk = 'clinic' then
      if n % 10 < 3 then
        select ur.user_id into target
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.workspace_id = rec.workspace_id and r.key = 'receptionist'
        order by ur.user_id
        limit 1;
      else
        select ur.user_id into target
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.workspace_id = rec.workspace_id and r.key = 'clinic_telecaller'
        order by ur.user_id
        limit 1;
      end if;
      n := n + 1;
    end if;
    if target is not null then
      update public.leads set assigned_to = target where id = rec.id and assigned_to is null;
    end if;
  end loop;
end $$;

alter table public.inventory_products replica identity full;
alter table public.patient_procedures replica identity full;
alter table public.clinic_ledger replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.inventory_products;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.patient_procedures;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.clinic_ledger;
exception when duplicate_object then null;
end $$;

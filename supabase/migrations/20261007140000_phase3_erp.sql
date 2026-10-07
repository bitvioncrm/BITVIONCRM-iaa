-- Phases 3–8. Does not edit earlier migrations.
-- Secrets for Meta and WhatsApp stay in server environment variables, not in these tables.

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add column if not exists source_platform text not null default '';
alter table public.leads add column if not exists source_campaign text not null default '';
alter table public.leads add column if not exists source_form text not null default '';
alter table public.leads add column if not exists assigned_at timestamptz;

create table if not exists public.lead_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  stage_key text not null,
  label text not null,
  position integer not null,
  unique (workspace_id, stage_key)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid references public.leads (id),
  title text not null,
  notes text not null default '',
  priority text not null default 'medium',
  status text not null default 'pending',
  due_at timestamptz,
  assigned_to uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint tasks_status_check check (status in ('pending', 'in_progress', 'completed', 'overdue'))
);

create index if not exists tasks_workspace_due_idx on public.tasks (workspace_id, due_at) where deleted_at is null;

create table if not exists public.call_time_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  user_id uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  status text not null default 'active',
  constraint call_time_status_check check (status in ('active', 'completed', 'interrupted')),
  constraint call_time_duration_check check (
    (status = 'completed' and duration_seconds is not null and duration_seconds >= 0)
    or (status <> 'completed' and duration_seconds is null)
  )
);

create index if not exists call_time_user_day_idx on public.call_time_sessions (user_id, workspace_id, started_at);

create table if not exists public.call_time_targets (
  workspace_id uuid not null references public.workspaces (id),
  user_id uuid not null references public.profiles (id),
  target_seconds integer not null default 9000,
  primary key (workspace_id, user_id)
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid references public.leads (id),
  patient_code text not null,
  full_name text not null,
  date_of_birth date,
  age integer,
  gender text not null default 'other',
  mobile text not null default '',
  email text not null default '',
  place text not null default '',
  address text not null default '',
  emergency_contact text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, patient_code)
);

create index if not exists patients_workspace_name_idx on public.patients (workspace_id, full_name);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  patient_id uuid not null references public.patients (id),
  doctor_id uuid references public.profiles (id),
  starts_at timestamptz not null,
  reason text not null default '',
  status text not null default 'scheduled',
  notes text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_status_check check (status in ('scheduled', 'confirmed', 'arrived', 'in_consultation', 'completed', 'cancelled', 'no_show'))
);

create index if not exists appointments_day_idx on public.appointments (workspace_id, starts_at);

create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  patient_id uuid not null references public.patients (id),
  appointment_id uuid references public.appointments (id),
  doctor_id uuid references public.profiles (id),
  diagnosis text not null default '',
  treatment_plan text not null default '',
  follow_up_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  consultation_id uuid not null references public.consultations (id),
  medicine text not null,
  dosage text not null default '',
  frequency text not null default '',
  duration text not null default '',
  instructions text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  name text not null,
  category text not null default '',
  batch text not null default '',
  expires_on date,
  purchase_price numeric(12, 2) not null default 0,
  selling_price numeric(12, 2) not null default 0,
  current_stock numeric(12, 2) not null default 0,
  minimum_stock numeric(12, 2) not null default 0,
  unit text not null default 'unit',
  supplier text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  product_id uuid not null references public.inventory_products (id),
  transaction_type text not null,
  quantity numeric(12, 2) not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint inventory_type_check check (transaction_type in ('purchase', 'sale', 'adjustment', 'return', 'damaged', 'expired', 'treatment'))
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  invoice_number text not null,
  patient_id uuid references public.patients (id),
  student_id uuid,
  status text not null default 'pending',
  discount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  issued_on date not null default current_date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (workspace_id, invoice_number),
  constraint invoices_status_check check (status in ('pending', 'partial', 'paid', 'refunded', 'cancelled'))
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  invoice_id uuid not null references public.invoices (id),
  amount numeric(12, 2) not null,
  method text not null,
  paid_on date not null default current_date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint payments_method_check check (method in ('cash', 'upi', 'card', 'bank_transfer', 'online_payment'))
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  invoice_id uuid not null references public.invoices (id),
  amount numeric(12, 2) not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  course_id uuid not null references public.courses (id),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid references public.leads (id),
  student_code text not null,
  full_name text not null,
  date_of_birth date,
  gender text not null default 'other',
  mobile text not null default '',
  email text not null default '',
  address text not null default '',
  course_id uuid references public.courses (id),
  batch_id uuid references public.batches (id),
  admission_date date,
  status text not null default 'admitted',
  counsellor_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, student_code)
);

alter table public.invoices drop constraint if exists invoices_student_id_fkey;
alter table public.invoices add constraint invoices_student_id_fkey foreign key (student_id) references public.students (id);

create table if not exists public.admissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  student_id uuid not null references public.students (id),
  course_id uuid references public.courses (id),
  admitted_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  course_id uuid references public.courses (id),
  name text not null,
  held_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.marks (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id),
  student_id uuid not null references public.students (id),
  score numeric(6, 2) not null,
  unique (exam_id, student_id)
);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  student_id uuid not null references public.students (id),
  title text not null,
  issued_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  entity_type text not null,
  entity_id uuid not null,
  category text not null default 'other',
  filename text not null,
  mime_type text not null,
  original_size integer not null,
  optimized_size integer,
  checksum text not null,
  storage_path text not null,
  processing_status text not null default 'ready',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists documents_checksum_idx on public.documents (organization_id, checksum);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  event_key text not null,
  conditions jsonb not null default '{}'::jsonb,
  action_key text not null,
  action jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.automation_rules (id),
  entity_type text not null,
  entity_id uuid not null,
  status text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.processed_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  processed_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

create table if not exists public.integration_status (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  provider text not null,
  status text not null default 'configuration_required',
  detail text not null default '',
  updated_at timestamptz not null default now(),
  unique (organization_id, provider),
  constraint integration_status_check check (status in ('connected', 'disconnected', 'error', 'configuration_required'))
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid references public.leads (id),
  channel text not null,
  direction text not null,
  body text not null default '',
  provider_message_id text,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  constraint messages_channel_check check (channel in ('whatsapp', 'instagram'))
);

create index if not exists messages_lead_idx on public.messages (lead_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create or replace function public.workspace_role_keys(ws uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select r.key
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid()
    and (ur.workspace_id = ws or public.is_super_admin() or exists (
      select 1 from public.workspaces w
      where w.id = ws and ur.organization_id = w.organization_id and r.key = 'admin'
    ));
$$;

create or replace function public.can_use_clinic(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (select 1 from public.workspaces w where w.id = ws and public.is_org_admin(w.organization_id))
    or exists (select 1 from public.workspace_role_keys(ws) k where k in ('receptionist', 'doctor', 'admin'));
$$;

create or replace function public.can_use_institute(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (select 1 from public.workspaces w where w.id = ws and public.is_org_admin(w.organization_id))
    or exists (select 1 from public.workspace_role_keys(ws) k where k in ('institute_user', 'institute_bde', 'admin'));
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
    or exists (select 1 from public.workspace_role_keys(ws) k where k = 'admin');
$$;

alter table public.lead_stages enable row level security;
alter table public.tasks enable row level security;
alter table public.call_time_sessions enable row level security;
alter table public.call_time_targets enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.consultations enable row level security;
alter table public.prescriptions enable row level security;
alter table public.inventory_products enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.courses enable row level security;
alter table public.batches enable row level security;
alter table public.students enable row level security;
alter table public.admissions enable row level security;
alter table public.exams enable row level security;
alter table public.marks enable row level security;
alter table public.certificates enable row level security;
alter table public.documents enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.processed_events enable row level security;
alter table public.integration_status enable row level security;
alter table public.messages enable row level security;

create policy lead_stages_rw on public.lead_stages for all to authenticated
  using (workspace_id in (select public.member_workspace_ids()))
  with check (workspace_id in (select public.member_workspace_ids()));

create policy tasks_rw on public.tasks for all to authenticated
  using (deleted_at is null and (assigned_to = auth.uid() or public.is_org_admin(organization_id) or public.is_super_admin()))
  with check (assigned_to = auth.uid() or public.is_org_admin(organization_id) or public.is_super_admin());

create policy call_time_own on public.call_time_sessions for all to authenticated
  using (user_id = auth.uid() or public.is_super_admin() or public.is_org_admin(organization_id))
  with check (user_id = auth.uid());

create policy call_targets_rw on public.call_time_targets for all to authenticated
  using (user_id = auth.uid() or public.is_super_admin() or public.is_org_admin((select w.organization_id from public.workspaces w where w.id = workspace_id)))
  with check (user_id = auth.uid() or public.is_super_admin() or public.is_org_admin((select w.organization_id from public.workspaces w where w.id = workspace_id)));

create policy patients_rw on public.patients for all to authenticated
  using (deleted_at is null and public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

create policy appointments_rw on public.appointments for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

create policy consultations_rw on public.consultations for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

create policy prescriptions_rw on public.prescriptions for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

create policy inventory_rw on public.inventory_products for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

create policy inventory_tx_rw on public.inventory_transactions for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

create policy invoices_rw on public.invoices for all to authenticated
  using (public.can_use_clinic(workspace_id) or public.can_use_institute(workspace_id))
  with check (public.can_use_clinic(workspace_id) or public.can_use_institute(workspace_id));

create policy invoice_items_rw on public.invoice_items for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and (public.can_use_clinic(i.workspace_id) or public.can_use_institute(i.workspace_id))))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and (public.can_use_clinic(i.workspace_id) or public.can_use_institute(i.workspace_id))));

create policy payments_rw on public.payments for all to authenticated
  using (public.can_use_clinic(workspace_id) or public.can_view_money(workspace_id))
  with check (public.can_use_clinic(workspace_id) or public.can_view_money(workspace_id));

create policy refunds_admin on public.refunds for all to authenticated
  using (public.can_view_money(workspace_id))
  with check (public.can_view_money(workspace_id));

create policy courses_rw on public.courses for all to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

create policy batches_rw on public.batches for all to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

create policy students_rw on public.students for all to authenticated
  using (deleted_at is null and public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

create policy admissions_rw on public.admissions for all to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

create policy exams_rw on public.exams for all to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

create policy marks_rw on public.marks for all to authenticated
  using (exists (select 1 from public.students s where s.id = student_id and public.can_use_institute(s.workspace_id)))
  with check (exists (select 1 from public.students s where s.id = student_id and public.can_use_institute(s.workspace_id)));

create policy certificates_rw on public.certificates for all to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

create policy documents_rw on public.documents for all to authenticated
  using (workspace_id in (select public.member_workspace_ids()))
  with check (workspace_id in (select public.member_workspace_ids()));

create policy automation_admin on public.automation_rules for all to authenticated
  using (public.is_super_admin() or public.is_org_admin(organization_id))
  with check (public.is_super_admin() or public.is_org_admin(organization_id));

create policy automation_runs_read on public.automation_runs for select to authenticated
  using (public.is_super_admin() or exists (select 1 from public.automation_rules r where r.id = rule_id and public.is_org_admin(r.organization_id)));

create policy processed_events_deny on public.processed_events for select to authenticated
  using (public.is_super_admin());

create policy integration_read on public.integration_status for select to authenticated
  using (public.is_super_admin() or public.is_org_admin(organization_id));

create policy messages_rw on public.messages for all to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or lead_id in (select l.id from public.leads l where l.assigned_to = auth.uid())
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or lead_id in (select l.id from public.leads l where l.assigned_to = auth.uid())
  );

create or replace function public.apply_stock_change(
  product uuid,
  kind text,
  qty numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  org uuid;
  ws uuid;
begin
  select organization_id, workspace_id into org, ws from public.inventory_products where id = product;
  if org is null then
    raise exception 'Product not found';
  end if;
  insert into public.inventory_transactions (organization_id, workspace_id, product_id, transaction_type, quantity, created_by)
  values (org, ws, product, kind, qty, auth.uid());
  update public.inventory_products
  set current_stock = current_stock + qty
  where id = product;
end;
$$;

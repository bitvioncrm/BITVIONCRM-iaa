-- Phase 2: leads, notes, follow-ups, assignment, status history.
-- Row access is enforced here. The browser filter is not the security boundary.
-- Phone and email are indexed for duplicate lookup. They are not unique, so an operator can import a row as separate.

create extension if not exists pg_trgm;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  full_name text not null,
  phone text not null default '',
  phone_digits text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored,
  whatsapp text not null default '',
  email text not null default '',
  email_normalized text generated always as (lower(btrim(coalesce(email, '')))) stored,
  gender text not null default 'other',
  age integer,
  location text not null default '',
  country text not null default '',
  position text not null default '',
  source text not null default 'other',
  priority text not null default 'medium',
  status text not null default 'new',
  assigned_to uuid references public.profiles (id),
  tags text[] not null default '{}',
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  converted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint leads_status_check check (
    status in (
      'new', 'contacted', 'interested', 'follow_up', 'documents_pending',
      'processing', 'interview', 'selected', 'converted', 'lost'
    )
  ),
  constraint leads_priority_check check (priority in ('low', 'medium', 'high', 'urgent'))
);

create index leads_workspace_created_idx on public.leads (organization_id, workspace_id, created_at desc) where deleted_at is null;
create index leads_workspace_status_idx on public.leads (workspace_id, status) where deleted_at is null;
create index leads_assigned_idx on public.leads (assigned_to) where deleted_at is null;
create index leads_phone_digits_idx on public.leads (organization_id, workspace_id, phone_digits) where deleted_at is null and phone_digits <> '';
create index leads_email_idx on public.leads (organization_id, workspace_id, email_normalized) where deleted_at is null and email_normalized <> '';
create index leads_search_trgm_idx on public.leads using gin (
  (full_name || ' ' || phone_digits || ' ' || email_normalized) gin_trgm_ops
);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid not null references public.leads (id),
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

create table public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid not null references public.leads (id),
  assigned_to uuid references public.profiles (id),
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index lead_assignments_lead_idx on public.lead_assignments (lead_id, created_at desc);

create table public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid not null references public.leads (id),
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index lead_status_history_lead_idx on public.lead_status_history (lead_id, created_at desc);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  lead_id uuid not null references public.leads (id),
  assigned_to uuid references public.profiles (id),
  follow_type text not null default 'general',
  due_at timestamptz not null,
  status text not null default 'pending',
  notes text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint followups_status_check check (status in ('pending', 'completed'))
);

create index followups_lead_idx on public.followups (lead_id, due_at);
create index followups_due_idx on public.followups (workspace_id, status, due_at);

create or replace function public.member_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.id
  from public.workspaces w
  where public.is_super_admin()
    and w.deleted_at is null
  union
  select ur.workspace_id
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and ur.workspace_id is not null
  union
  select w.id
  from public.workspaces w
  join public.user_roles ur on ur.organization_id = w.organization_id
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid()
    and r.key = 'admin'
    and w.deleted_at is null;
$$;

create or replace function public.is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
        and ur.organization_id = org
        and r.key = 'admin'
    );
$$;

create or replace function public.can_read_lead(ws uuid, assigned uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select ws in (select public.member_workspace_ids())
    and (
      public.is_super_admin()
      or exists (
        select 1
        from public.workspaces w
        where w.id = ws
          and public.is_org_admin(w.organization_id)
      )
      or assigned = auth.uid()
    );
$$;

create or replace function public.can_write_lead(ws uuid, assigned uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_lead(ws, coalesce(assigned, auth.uid()))
    and (
      public.is_super_admin()
      or exists (
        select 1
        from public.workspaces w
        where w.id = ws
          and public.is_org_admin(w.organization_id)
      )
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = auth.uid()
          and ur.workspace_id = ws
          and r.key in ('clinic_bde', 'institute_bde', 'admin')
          and (assigned is null or assigned = auth.uid() or r.key = 'admin')
      )
    );
$$;

alter table public.leads enable row level security;
alter table public.lead_notes enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.lead_status_history enable row level security;
alter table public.followups enable row level security;

create policy leads_select on public.leads
  for select to authenticated
  using (deleted_at is null and public.can_read_lead(workspace_id, assigned_to));

create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    public.can_write_lead(workspace_id, assigned_to)
    and created_by = auth.uid()
    and organization_id = (select w.organization_id from public.workspaces w where w.id = workspace_id)
  );

create policy leads_update on public.leads
  for update to authenticated
  using (public.can_write_lead(workspace_id, assigned_to))
  with check (
    public.can_write_lead(workspace_id, assigned_to)
    and organization_id = (select w.organization_id from public.workspaces w where w.id = workspace_id)
  );

create policy lead_notes_all on public.lead_notes
  for all to authenticated
  using (public.can_read_lead(workspace_id, (select l.assigned_to from public.leads l where l.id = lead_id)))
  with check (public.can_write_lead(workspace_id, (select l.assigned_to from public.leads l where l.id = lead_id)));

create policy lead_assignments_select on public.lead_assignments
  for select to authenticated
  using (public.can_read_lead(workspace_id, assigned_to));

create policy lead_assignments_insert on public.lead_assignments
  for insert to authenticated
  with check (public.can_write_lead(workspace_id, assigned_to));

create policy lead_status_select on public.lead_status_history
  for select to authenticated
  using (workspace_id in (select public.member_workspace_ids()));

create policy lead_status_insert on public.lead_status_history
  for insert to authenticated
  with check (public.can_write_lead(workspace_id, auth.uid()) or public.is_super_admin() or exists (
    select 1 from public.workspaces w where w.id = workspace_id and public.is_org_admin(w.organization_id)
  ));

create policy followups_all on public.followups
  for all to authenticated
  using (public.can_read_lead(workspace_id, assigned_to))
  with check (public.can_write_lead(workspace_id, assigned_to));

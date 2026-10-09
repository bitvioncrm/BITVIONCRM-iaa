-- Meta form-to-desk routing. Does not delete or rewrite existing business rows.

alter table public.leads add column if not exists meta_page_id text not null default '';
alter table public.leads add column if not exists meta_form_id text not null default '';
alter table public.leads add column if not exists meta_adset_name text not null default '';
alter table public.leads add column if not exists meta_ad_id text not null default '';
alter table public.leads add column if not exists meta_leadgen_id text not null default '';
alter table public.leads add column if not exists imported_at timestamptz;
alter table public.leads add column if not exists source_created_at timestamptz;

create unique index if not exists leads_meta_leadgen_uidx
  on public.leads (meta_leadgen_id)
  where meta_leadgen_id <> '' and deleted_at is null;

create index if not exists leads_meta_created_idx
  on public.leads (workspace_id, created_at desc)
  where deleted_at is null and source_platform = 'meta';

create table if not exists public.meta_form_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  page_id text not null default '',
  form_id text not null,
  form_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, page_id)
);

create index if not exists meta_form_mappings_form_idx on public.meta_form_mappings (form_id) where active;

create table if not exists public.meta_import_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  leadgen_id text not null,
  page_id text not null default '',
  form_id text not null default '',
  workspace_id uuid references public.workspaces (id),
  lead_id uuid,
  status text not null,
  error_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leadgen_id),
  constraint meta_import_status_check check (status in ('stored', 'duplicate', 'unmapped', 'failed', 'invalid'))
);

create index if not exists meta_import_events_status_idx on public.meta_import_events (organization_id, status, updated_at desc);

alter table public.integration_status add column if not exists last_success_at timestamptz;
alter table public.integration_status add column if not exists last_event_at timestamptz;

alter table public.meta_form_mappings enable row level security;
alter table public.meta_import_events enable row level security;

drop policy if exists meta_mappings_admin on public.meta_form_mappings;
create policy meta_mappings_admin on public.meta_form_mappings
  for all to authenticated
  using (public.is_super_admin() or public.is_org_admin(organization_id))
  with check (public.is_super_admin() or public.is_org_admin(organization_id));

drop policy if exists meta_imports_read on public.meta_import_events;
create policy meta_imports_read on public.meta_import_events
  for select to authenticated
  using (public.is_super_admin() or public.is_org_admin(organization_id));

revoke update, delete on public.meta_import_events from anon, authenticated;

create sequence if not exists public.patient_code_seq;
create sequence if not exists public.student_code_seq;

create or replace function public.next_patient_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.workspaces w
    where w.workspace_type = 'clinic'
      and w.deleted_at is null
      and (
        public.is_super_admin()
        or public.is_org_admin(w.organization_id)
        or public.can_use_clinic(w.id)
      )
  ) then
    raise exception 'Not allowed';
  end if;
  return 'DKC-P-' || lpad(nextval('public.patient_code_seq')::text, 6, '0');
end;
$$;

create or replace function public.next_student_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.workspaces w
    where w.workspace_type = 'institute'
      and w.deleted_at is null
      and (
        public.is_super_admin()
        or public.is_org_admin(w.organization_id)
        or public.can_use_institute(w.id)
      )
  ) then
    raise exception 'Not allowed';
  end if;
  return 'IAA-S-' || lpad(nextval('public.student_code_seq')::text, 6, '0');
end;
$$;

revoke all on function public.next_patient_code() from public, anon;
revoke all on function public.next_student_code() from public, anon;
grant execute on function public.next_patient_code() to authenticated;
grant execute on function public.next_student_code() to authenticated;

create or replace function public.unpaid_total(ws uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.can_view_money(ws) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select sum(greatest(i.total - coalesce(p.paid, 0), 0))
    from public.invoices i
    left join (
      select invoice_id, sum(amount) as paid
      from public.payments
      group by invoice_id
    ) p on p.invoice_id = i.id
    where i.workspace_id = ws
      and i.status in ('pending', 'partial')
  ), 0);
end;
$$;

revoke all on function public.unpaid_total(uuid) from public, anon;
grant execute on function public.unpaid_total(uuid) to authenticated;

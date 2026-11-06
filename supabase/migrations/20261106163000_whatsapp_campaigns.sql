create table if not exists public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  name text not null default '',
  body text not null default '',
  poster_path text not null default '',
  status text not null default 'draft' check (status in ('draft', 'running', 'completed')),
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  total_count integer not null default 0,
  cursor_offset integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists whatsapp_campaigns_desk_idx
  on public.whatsapp_campaigns (workspace_id, created_at desc)
  where deleted_at is null;

alter table public.whatsapp_campaigns enable row level security;

drop policy if exists whatsapp_campaigns_admin on public.whatsapp_campaigns;
create policy whatsapp_campaigns_admin on public.whatsapp_campaigns
  for all to authenticated
  using (public.is_super_admin() or public.is_org_admin(organization_id))
  with check (public.is_super_admin() or public.is_org_admin(organization_id));

grant select, insert, update, delete on public.whatsapp_campaigns to authenticated;

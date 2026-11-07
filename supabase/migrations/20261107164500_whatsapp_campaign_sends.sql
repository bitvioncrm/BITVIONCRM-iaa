create table if not exists public.whatsapp_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workspace_id uuid not null references public.workspaces (id),
  campaign_id uuid not null references public.whatsapp_campaigns (id) on delete cascade,
  lead_id uuid references public.leads (id),
  phone text not null default '',
  lead_name text not null default '',
  status text not null default 'failed' check (status in ('sent', 'failed', 'skipped')),
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_campaign_sends_campaign_idx
  on public.whatsapp_campaign_sends (campaign_id, created_at desc);

create index if not exists whatsapp_campaign_sends_status_idx
  on public.whatsapp_campaign_sends (campaign_id, status);

alter table public.whatsapp_campaign_sends enable row level security;

drop policy if exists whatsapp_campaign_sends_admin on public.whatsapp_campaign_sends;
create policy whatsapp_campaign_sends_admin on public.whatsapp_campaign_sends
  for all to authenticated
  using (public.is_super_admin() or public.is_org_admin(organization_id))
  with check (public.is_super_admin() or public.is_org_admin(organization_id));

grant select, insert, update, delete on public.whatsapp_campaign_sends to authenticated;

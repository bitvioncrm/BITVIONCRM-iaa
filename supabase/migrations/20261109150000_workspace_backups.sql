create table if not exists public.workspace_backups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  workspace_id uuid not null references public.workspaces(id),
  workspace_type text not null check (workspace_type in ('clinic', 'institute')),
  kind text not null check (kind in ('instant', 'rolling', 'alternate')),
  label text not null default '',
  status text not null default 'ready' check (status in ('pending', 'running', 'ready', 'failed')),
  storage_path text not null default '',
  byte_size bigint not null default 0,
  table_count integer not null default 0,
  row_count integer not null default 0,
  checksum text not null default '',
  detail text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists workspace_backups_ws_kind_idx
  on public.workspace_backups (workspace_id, kind, created_at desc);

alter table public.workspace_backups enable row level security;

grant select, insert, update, delete on public.workspace_backups to authenticated;

drop policy if exists workspace_backups_admin on public.workspace_backups;
create policy workspace_backups_admin on public.workspace_backups
  for all to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k.k in ('admin', 'super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k.k in ('admin', 'super_admin')
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-backups', 'workspace-backups', false, 104857600, array['application/json', 'application/gzip', 'application/octet-stream'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

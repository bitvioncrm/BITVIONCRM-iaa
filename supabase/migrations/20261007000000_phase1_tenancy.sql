-- Phase 1: organizations, workspaces, roles, permissions, RLS.
-- Clinic and institute are not seeded. The first Auth user becomes super admin.

create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null,
  slug text not null,
  workspace_type text not null default 'custom',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  unique (organization_id, slug)
);

create table public.workspace_modules (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  module_key text not null,
  enabled boolean not null default false,
  primary key (workspace_id, module_key)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id),
  full_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id),
  organization_id uuid references public.organizations (id),
  workspace_id uuid references public.workspaces (id),
  created_at timestamptz not null default now(),
  unique (user_id, role_id, organization_id, workspace_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  workspace_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.roles (key, name) values
  ('super_admin', 'Super Admin'),
  ('admin', 'Admin'),
  ('receptionist', 'Receptionist'),
  ('clinic_bde', 'Clinic BDE'),
  ('institute_bde', 'Institute BDE'),
  ('doctor', 'Doctor'),
  ('institute_user', 'Institute User');

insert into public.permissions (key) values
  ('view'), ('create'), ('read'), ('update'), ('delete'),
  ('assign'), ('export'), ('import'), ('approve'), ('configure');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'super_admin';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('view', 'create', 'read', 'update', 'delete', 'assign', 'export', 'import', 'approve')
where r.key = 'admin';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('view', 'create', 'read', 'update')
where r.key in ('receptionist', 'doctor', 'institute_user');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('view', 'create', 'read', 'update', 'export')
where r.key in ('clinic_bde', 'institute_bde');

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.key = 'super_admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_user boolean;
  super_id uuid;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  if first_user then
    select id into super_id from public.roles where key = 'super_admin';
    insert into public.user_roles (user_id, role_id)
    values (new.id, super_id);
    insert into public.audit_logs (user_id, action, entity, entity_id, metadata)
    values (new.id, 'LOGIN', 'profiles', new.id, '{"event":"first_super_admin"}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.organizations enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_modules enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select on public.organizations
  for select to authenticated
  using (
    public.is_super_admin()
    or id in (
      select ur.organization_id from public.user_roles ur where ur.user_id = auth.uid() and ur.organization_id is not null
    )
    or id in (
      select p.organization_id from public.profiles p where p.id = auth.uid() and p.organization_id is not null
    )
  );

create policy organizations_write on public.organizations
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (
    public.is_super_admin()
    or organization_id in (
      select ur.organization_id from public.user_roles ur where ur.user_id = auth.uid() and ur.organization_id is not null
    )
  );

create policy workspaces_write on public.workspaces
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy modules_select on public.workspace_modules
  for select to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id
        and (
          public.is_super_admin()
          or w.organization_id in (
            select ur.organization_id from public.user_roles ur where ur.user_id = auth.uid() and ur.organization_id is not null
          )
        )
    )
  );

create policy modules_write on public.workspace_modules
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_super_admin());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

create policy roles_read on public.roles
  for select to authenticated
  using (true);

create policy permissions_read on public.permissions
  for select to authenticated
  using (true);

create policy role_permissions_read on public.role_permissions
  for select to authenticated
  using (true);

create policy role_permissions_write on public.role_permissions
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

create policy user_roles_write on public.user_roles
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy audit_insert on public.audit_logs
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_super_admin());

create policy audit_select on public.audit_logs
  for select to authenticated
  using (public.is_super_admin() or user_id = auth.uid());

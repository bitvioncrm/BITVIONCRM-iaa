drop function if exists public.list_workspace_channels();

create function public.list_workspace_channels()
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_type text,
  organization_id uuid,
  channel text,
  app_id text,
  page_id text,
  phone_number_id text,
  display_phone text,
  waba_id text,
  ad_account_id text,
  access_token_set boolean,
  app_secret_set boolean,
  verify_token_set boolean,
  verify_token text,
  access_token_last4 text,
  status text,
  detail text,
  last_checked_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_super_admin() and not exists (
    select 1 from public.organizations o where public.is_org_admin(o.id)
  ) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    s.workspace_id,
    w.name,
    w.workspace_type,
    s.organization_id,
    s.channel,
    s.app_id,
    s.page_id,
    s.phone_number_id,
    s.display_phone,
    s.waba_id,
    s.ad_account_id,
    (s.access_token <> ''),
    (s.app_secret <> ''),
    (s.verify_token <> ''),
    s.verify_token,
    case when length(s.access_token) >= 4 then right(s.access_token, 4) else '' end,
    s.status,
    s.detail,
    s.last_checked_at,
    s.updated_at
  from public.workspace_channel_secrets s
  join public.workspaces w on w.id = s.workspace_id
  where w.deleted_at is null
    and (public.is_super_admin() or public.is_org_admin(s.organization_id));
end;
$$;

revoke all on function public.list_workspace_channels() from public, anon;
grant execute on function public.list_workspace_channels() to authenticated, service_role;

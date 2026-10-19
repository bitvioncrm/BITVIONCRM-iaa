-- Clinic and institute each keep an ads account id. Every campaign in that
-- account is routed to that desk.

alter table public.workspace_channel_secrets
  add column if not exists ad_account_id text not null default '';

drop function if exists public.list_workspace_channels();
drop function if exists public.save_workspace_channel(uuid, text, text, text, text, text, text, text, text, text);

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

create function public.save_workspace_channel(
  p_workspace uuid,
  p_channel text,
  p_app_id text default '',
  p_page_id text default '',
  p_phone_number_id text default '',
  p_display_phone text default '',
  p_waba_id text default '',
  p_access_token text default '',
  p_app_secret text default '',
  p_verify_token text default '',
  p_ad_account_id text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  next_token text;
  next_secret text;
  next_verify text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_channel not in ('meta', 'whatsapp') then
    raise exception 'Unsupported channel';
  end if;

  select organization_id into org
  from public.workspaces
  where id = p_workspace and deleted_at is null and workspace_type in ('clinic', 'institute');

  if org is null then
    raise exception 'Desk not found';
  end if;
  if not (public.is_super_admin() or public.is_org_admin(org)) then
    raise exception 'Not allowed';
  end if;

  select
    case when nullif(trim(p_access_token), '') is null then coalesce(s.access_token, '') else trim(p_access_token) end,
    case when nullif(trim(p_app_secret), '') is null then coalesce(s.app_secret, '') else trim(p_app_secret) end,
    case when nullif(trim(p_verify_token), '') is null then coalesce(s.verify_token, '') else trim(p_verify_token) end
  into next_token, next_secret, next_verify
  from public.workspace_channel_secrets s
  where s.workspace_id = p_workspace and s.channel = p_channel;

  next_token := coalesce(next_token, nullif(trim(p_access_token), ''), '');
  next_secret := coalesce(next_secret, nullif(trim(p_app_secret), ''), '');
  next_verify := coalesce(next_verify, nullif(trim(p_verify_token), ''), '');

  insert into public.workspace_channel_secrets (
    organization_id, workspace_id, channel, app_id, page_id, phone_number_id, display_phone, waba_id, ad_account_id,
    access_token, app_secret, verify_token, status, detail, updated_at
  ) values (
    org, p_workspace, p_channel, trim(coalesce(p_app_id, '')), trim(coalesce(p_page_id, '')),
    trim(coalesce(p_phone_number_id, '')), trim(coalesce(p_display_phone, '')), trim(coalesce(p_waba_id, '')),
    trim(coalesce(p_ad_account_id, '')), next_token, next_secret, next_verify,
    'configuration_required', 'Credentials saved. Run Test connection.', now()
  )
  on conflict (workspace_id, channel) do update
  set
    app_id = excluded.app_id,
    page_id = excluded.page_id,
    phone_number_id = excluded.phone_number_id,
    display_phone = excluded.display_phone,
    waba_id = excluded.waba_id,
    ad_account_id = excluded.ad_account_id,
    access_token = excluded.access_token,
    app_secret = excluded.app_secret,
    verify_token = excluded.verify_token,
    status = 'configuration_required',
    detail = 'Credentials saved. Run Test connection.',
    updated_at = now();
end;
$$;

revoke all on function public.list_workspace_channels() from public, anon;
revoke all on function public.save_workspace_channel(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.list_workspace_channels() to authenticated, service_role;
grant execute on function public.save_workspace_channel(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;

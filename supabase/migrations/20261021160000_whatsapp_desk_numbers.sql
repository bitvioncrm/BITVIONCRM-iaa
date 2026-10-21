-- Clinic and institute each store their own WhatsApp number.
-- The browser can read the number. Tokens stay on the server.

create or replace function public.list_whatsapp_numbers()
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_type text,
  display_phone text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.name, w.workspace_type, coalesce(s.display_phone, '')
  from public.workspaces w
  left join public.workspace_channel_secrets s
    on s.workspace_id = w.id
    and s.channel = 'whatsapp'
  where w.deleted_at is null
    and w.workspace_type in ('clinic', 'institute')
    and auth.uid() is not null
    and (
      public.is_super_admin()
      or public.is_org_admin(w.organization_id)
      or w.id in (select ur.workspace_id from public.user_roles ur where ur.user_id = auth.uid())
    )
  order by w.workspace_type;
$$;

create or replace function public.save_whatsapp_number(p_workspace uuid, p_display_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select w.organization_id into org
  from public.workspaces w
  where w.id = p_workspace
    and w.deleted_at is null
    and w.workspace_type in ('clinic', 'institute');

  if org is null then
    raise exception 'Desk not found';
  end if;
  if not (public.is_super_admin() or public.is_org_admin(org)) then
    raise exception 'Only an admin can save a WhatsApp number';
  end if;

  insert into public.workspace_channel_secrets (
    organization_id, workspace_id, channel, display_phone, updated_at
  ) values (
    org, p_workspace, 'whatsapp', trim(coalesce(p_display_phone, '')), now()
  )
  on conflict (workspace_id, channel) do update
  set display_phone = excluded.display_phone,
      updated_at = now();
end;
$$;

revoke all on function public.list_whatsapp_numbers() from public, anon;
grant execute on function public.list_whatsapp_numbers() to authenticated;

revoke all on function public.save_whatsapp_number(uuid, text) from public, anon;
grant execute on function public.save_whatsapp_number(uuid, text) to authenticated;

-- The browser must not read workspace_channel_secrets. This returns only
-- whether a desk already has a WhatsApp phone number id.

create or replace function public.whatsapp_lines()
returns table (workspace_id uuid, connected boolean)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, coalesce(s.phone_number_id, '') <> ''
  from public.workspaces w
  left join public.workspace_channel_secrets s
    on s.workspace_id = w.id and s.channel = 'whatsapp'
  where w.deleted_at is null
    and auth.uid() is not null
    and (
      public.is_super_admin()
      or public.is_org_admin(w.organization_id)
      or w.id in (select ur.workspace_id from public.user_roles ur where ur.user_id = auth.uid())
    );
$$;

revoke all on function public.whatsapp_lines() from public, anon;
grant execute on function public.whatsapp_lines() to authenticated;

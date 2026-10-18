-- Soft-delete for clinic stock so products can be removed without losing history.
-- Opening stock for Face wash, Moisturizer, and Sunscreen from the 5 Oct 2026 sheet.

alter table public.inventory_products
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists inventory_products_workspace_active_idx
  on public.inventory_products (workspace_id, category, name)
  where deleted_at is null;

drop policy if exists inventory_clinical on public.inventory_products;
create policy inventory_clinical on public.inventory_products
  for all to authenticated
  using (
    deleted_at is null
    and (
      public.is_super_admin()
      or public.is_org_admin(organization_id)
      or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
    )
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('doctor', 'admin'))
  );

create or replace function public.seed_clinic_skincare_stock()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clinic_ws uuid;
  clinic_org uuid;
  inserted integer := 0;
  row_name text;
  row_category text;
  row_stock numeric;
begin
  select id, organization_id into clinic_ws, clinic_org
  from public.workspaces
  where workspace_type = 'clinic' and deleted_at is null
  order by created_at
  limit 1;

  if clinic_ws is null then
    return 0;
  end if;

  for row_name, row_category, row_stock in
    select * from (values
      ('Acmist face wash', 'Face wash', 10::numeric),
      ('uvdox oc cleanser', 'Face wash', 17),
      ('uvdox cleanser', 'Face wash', 18),
      ('Ethiglo face wash', 'Face wash', 23),
      ('babe Micellar gel sensitive', 'Face wash', 10),
      ('Triaximax Moisturizer', 'Moisturizer', 24),
      ('Acmist Moisturizer', 'Moisturizer', 18),
      ('OAT Heal Moisturizer', 'Moisturizer', 10),
      ('Dowse Moisturizer', 'Moisturizer', 28),
      ('Avobop Moisturizer', 'Moisturizer', 15),
      ('uvdox oc Moisturizer', 'Moisturizer', 13),
      ('uvdox sunscreen', 'Sunscreen', 32),
      ('uvdox oc sunscreen', 'Sunscreen', 15),
      ('Ray bounce sunscreen', 'Sunscreen', 25),
      ('Ray Bounce Silicon', 'Sunscreen', 13),
      ('360° Block Sunscreen', 'Sunscreen', 24),
      ('UVSKRIN Silicon sunscreen', 'Sunscreen', 11),
      ('UVSKRIN H2O water based sunscreen', 'Sunscreen', 12)
    ) as seed(name, category, stock)
  loop
    if exists (
      select 1
      from public.inventory_products p
      where p.workspace_id = clinic_ws
        and lower(p.name) = lower(row_name)
        and p.deleted_at is null
    ) then
      continue;
    end if;

    insert into public.inventory_products (
      organization_id,
      workspace_id,
      name,
      category,
      current_stock,
      minimum_stock,
      purchase_price,
      selling_price,
      unit,
      supplier
    ) values (
      clinic_org,
      clinic_ws,
      row_name,
      row_category,
      row_stock,
      5,
      0,
      0,
      'unit',
      ''
    );

    insert into public.inventory_transactions (
      organization_id,
      workspace_id,
      product_id,
      transaction_type,
      quantity,
      note
    )
    select
      clinic_org,
      clinic_ws,
      p.id,
      'purchase',
      row_stock,
      'Opening stock from clinic sheet 1 Sep 2026 to 5 Oct 2026'
    from public.inventory_products p
    where p.workspace_id = clinic_ws
      and lower(p.name) = lower(row_name)
      and p.deleted_at is null
    order by p.created_at desc
    limit 1;

    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;

revoke all on function public.seed_clinic_skincare_stock() from public, anon;
grant execute on function public.seed_clinic_skincare_stock() to authenticated, service_role;

select public.seed_clinic_skincare_stock();

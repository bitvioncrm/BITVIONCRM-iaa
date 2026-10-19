-- Harden inventory RPCs: revoke public/anon execute, require authenticated
-- session + clinic membership for seed, and stop the legacy skincare seed
-- from creating duplicate products with mismatched names.

revoke all on function public.apply_stock_change(uuid, text, numeric, text) from public, anon;
revoke all on function public.confirm_inventory_stock_out(uuid, jsonb, text, text) from public, anon;
grant execute on function public.apply_stock_change(uuid, text, numeric, text) to authenticated, service_role;
grant execute on function public.confirm_inventory_stock_out(uuid, jsonb, text, text) to authenticated, service_role;

revoke all on function public.seed_clinic_inventory_catalogue() from public, anon;
revoke all on function public.reconcile_clinic_inventory_sheet_stock(boolean) from public, anon;

-- Replace zero-arg seed with an optional workspace argument (no second overload).
drop function if exists public.seed_clinic_inventory_catalogue();

create or replace function public.seed_clinic_inventory_catalogue(p_workspace uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clinic_ws uuid;
  clinic_org uuid;
  touched integer := 0;
  row_sku text;
  row_name text;
  row_category text;
  row_stock numeric;
  row_verify boolean;
  match_id uuid;
  alias text;
  name_360 text := '360' || chr(176) || ' Block Sunscreen';
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_workspace is not null then
    select id, organization_id into clinic_ws, clinic_org
    from public.workspaces
    where id = p_workspace
      and workspace_type = 'clinic'
      and deleted_at is null;
  else
    select id, organization_id into clinic_ws, clinic_org
    from public.workspaces
    where workspace_type = 'clinic' and deleted_at is null
    order by created_at
    limit 1;
  end if;

  if clinic_ws is null then
    return 0;
  end if;

  if not (
    public.is_super_admin()
    or public.is_org_admin(clinic_org)
    or exists (
      select 1 from public.workspace_role_keys(clinic_ws) k
      where k in ('admin', 'doctor')
    )
  ) then
    raise exception 'Not allowed to sync clinic inventory';
  end if;

  for row_sku, row_name, row_category, row_stock, row_verify, alias in
    select * from (values
      ('CLN-FW-001', 'Acmist Face Wash', 'Face Wash & Cleansers', 10::numeric, false, 'acmist face wash'),
      ('CLN-FW-002', 'Uvdox OC Cleanser', 'Face Wash & Cleansers', 17, false, 'uvdox oc cleanser'),
      ('CLN-FW-003', 'Uvdox Cleanser', 'Face Wash & Cleansers', 18, false, 'uvdox cleanser'),
      ('CLN-FW-004', 'Ethiglo Face Wash', 'Face Wash & Cleansers', 23, false, 'ethiglo face wash'),
      ('CLN-FW-005', 'Babe Micellar Gel Sensitive', 'Face Wash & Cleansers', 10, false, 'babe micellar gel sensitive'),
      ('CLN-MZ-001', 'Triaumax Moisturizer', 'Moisturizers', 24, false, 'triaximax moisturizer'),
      ('CLN-MZ-002', 'Acmist Moisturizer', 'Moisturizers', 18, false, 'acmist moisturizer'),
      ('CLN-MZ-003', 'OAT Heal Moisturizer', 'Moisturizers', 10, false, 'oat heal moisturizer'),
      ('CLN-MZ-004', 'Dowse Moisturizer', 'Moisturizers', 28, false, 'dowse moisturizer'),
      ('CLN-MZ-005', 'Avobop Moisturizer', 'Moisturizers', 15, false, 'avobop moisturizer'),
      ('CLN-MZ-006', 'Uvdox OC Moisturizer', 'Moisturizers', 13, false, 'uvdox oc moisturizer'),
      ('CLN-SS-001', 'Uvdox Sunscreen', 'Sunscreens', 32, false, 'uvdox sunscreen'),
      ('CLN-SS-002', 'Uvdox OC Sunscreen', 'Sunscreens', 15, false, 'uvdox oc sunscreen'),
      ('CLN-SS-003', 'Re''equil Bounce Sunscreen', 'Sunscreens', 25, false, 'ray bounce sunscreen'),
      ('CLN-SS-004', 'Re''equil Bounce Silicone', 'Sunscreens', 13, false, 'ray bounce silicon'),
      ('CLN-SS-005', name_360, 'Sunscreens', 24, false, '360 block sunscreen'),
      ('CLN-SS-006', 'UVSKRIN Silicon Sunscreen', 'Sunscreens', 11, false, 'uvskrin silicon sunscreen'),
      ('CLN-SS-007', 'UVSKRIN H2O Water-Based Sunscreen', 'Sunscreens', 12, false, 'uvskrin h2o water based sunscreen'),
      ('CLN-SR-001', 'HA 4 Serum', 'Serums', 19, false, 'ha 4 serum'),
      ('CLN-SR-002', 'Acne Face Serum', 'Serums', 19, false, 'acne face serum'),
      ('CLN-SR-003', 'HA 5 Serum', 'Serums', 5, false, 'ha 5 serum'),
      ('CLN-SR-004', 'Retinol Serum VRH', 'Serums', 4, false, 'retinol serum vrh'),
      ('CLN-SR-005', 'Spotherapy Serum', 'Serums', 17, false, 'spotherapy serum'),
      ('CLN-SR-006', 'Dinora Vit C & Glutathione Serum', 'Serums', 11, false, 'dinora vit c & glutathione serum'),
      ('CLN-NC-001', 'Yubello', 'Night Creams & Skin-Care', 29, false, 'yubello'),
      ('CLN-NC-002', 'Me-Line', 'Night Creams & Skin-Care', 4, false, 'me-line'),
      ('CLN-NC-003', 'Cicatrix', 'Night Creams & Skin-Care', 3, false, 'cicatrix'),
      ('CLN-NC-004', 'Plinoromus', 'Night Creams & Skin-Care', 19, true, 'plinoromus'),
      ('CLN-NC-005', 'Triclear N', 'Night Creams & Skin-Care', 3, false, 'triclear n'),
      ('CLN-NC-006', 'Acne Scar', 'Night Creams & Skin-Care', 10, false, 'acne scar'),
      ('CLN-NC-007', 'Cuticance', 'Night Creams & Skin-Care', 11, false, 'cuticance'),
      ('CLN-NC-008', 'Melanil Cream', 'Night Creams & Skin-Care', 14, false, 'melanil cream'),
      ('CLN-NC-009', 'Age Defy Tablets', 'Night Creams & Skin-Care', 23, false, 'age defy tablets'),
      ('CLN-NC-010', 'Nrish Tablets', 'Night Creams & Skin-Care', 20, false, 'nrish tablets'),
      ('CLN-NC-011', 'Lip Balm', 'Night Creams & Skin-Care', 14, false, 'lip balm'),
      ('CLN-NC-012', 'Avotop Under-Eye', 'Night Creams & Skin-Care', 20, false, 'avotop under-eye'),
      ('CLN-NC-013', 'IVI 10', 'Night Creams & Skin-Care', 6, true, 'ivi 10'),
      ('CLN-HC-001', 'Folisuv Serum', 'Hair Care', 7, false, 'folisuv serum'),
      ('CLN-HC-002', 'Folisuv Tablets', 'Hair Care', 1, false, 'folisuv tablets'),
      ('CLN-HC-003', 'Minogain Tablets', 'Hair Care', 9, false, 'minogain tablets'),
      ('CLN-HC-004', 'HDRS Anti-Dandruff Shampoo', 'Hair Care', 19, false, 'hdrs anti-dandruff shampoo'),
      ('CLN-HC-005', 'Luly ZS Anti-Dandruff Shampoo', 'Hair Care', 3, false, 'luly zs anti-dandruff shampoo'),
      ('CLN-HC-006', 'Haironomics Hairfall Control Shampoo', 'Hair Care', 8, false, 'haironomics hairfall control shampoo'),
      ('CLN-FC-001', 'Foot Soft', 'Foot Care', 10, false, 'foot soft')
    ) as seed(sku, name, category, stock, verify, alias)
  loop
    select p.id into match_id
    from public.inventory_products p
    where p.workspace_id = clinic_ws
      and p.deleted_at is null
      and (
        lower(p.sku) = lower(row_sku)
        or lower(p.name) = lower(row_name)
        or lower(p.name) = lower(alias)
        or (row_sku = 'CLN-SS-005' and lower(p.name) like '360%block sunscreen%')
      )
    order by case when lower(p.sku) = lower(row_sku) then 0 when lower(p.name) = lower(row_name) then 1 else 2 end
    limit 1;

    if match_id is not null then
      update public.inventory_products
      set
        name = row_name,
        sku = case when coalesce(sku, '') = '' then row_sku else sku end,
        category = row_category,
        requires_name_verification = row_verify,
        updated_at = now()
      where id = match_id;
      touched := touched + 1;
    else
      insert into public.inventory_products (
        organization_id, workspace_id, name, sku, category, current_stock, minimum_stock,
        purchase_price, selling_price, unit, supplier, is_active, requires_name_verification
      ) values (
        clinic_org, clinic_ws, row_name, row_sku, row_category, row_stock, 5,
        null, null, 'unit', '', true, row_verify
      )
      returning id into match_id;

      insert into public.inventory_transactions (
        organization_id, workspace_id, product_id, transaction_type, quantity, note, previous_quantity, resulting_quantity
      ) values (
        clinic_org, clinic_ws, match_id, 'purchase', row_stock,
        'Opening stock from clinic inventory sheet', 0, row_stock
      );

      touched := touched + 1;
    end if;
  end loop;

  return touched;
end;
$$;

create or replace function public.seed_clinic_skincare_stock()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Legacy button: never create alternate-name duplicates; sync the catalogue instead.
  return public.seed_clinic_inventory_catalogue(null);
end;
$$;

create or replace function public.reconcile_clinic_inventory_sheet_stock(p_force boolean default false)
returns table (
  product_name text,
  sku text,
  current_quantity numeric,
  expected_quantity numeric,
  difference numeric,
  final_quantity numeric,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clinic_ws uuid;
  clinic_org uuid;
  rec record;
  match_id uuid;
  live_moves integer;
  current_qty numeric;
  final_qty numeric;
  act text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id, organization_id into clinic_ws, clinic_org
  from public.workspaces
  where workspace_type = 'clinic' and deleted_at is null
  order by created_at
  limit 1;

  if clinic_ws is null then
    return;
  end if;

  if not (
    public.is_super_admin()
    or public.is_org_admin(clinic_org)
  ) then
    raise exception 'Not allowed to reconcile clinic inventory';
  end if;

  if p_force and not public.is_super_admin() then
    raise exception 'Forced stock overwrite requires super admin';
  end if;

  for rec in
    select * from (values
      ('CLN-FW-001', 'Acmist Face Wash', 10::numeric),
      ('CLN-FW-002', 'Uvdox OC Cleanser', 17),
      ('CLN-FW-003', 'Uvdox Cleanser', 18),
      ('CLN-FW-004', 'Ethiglo Face Wash', 23),
      ('CLN-FW-005', 'Babe Micellar Gel Sensitive', 10),
      ('CLN-MZ-001', 'Triaumax Moisturizer', 24),
      ('CLN-MZ-002', 'Acmist Moisturizer', 18),
      ('CLN-MZ-003', 'OAT Heal Moisturizer', 10),
      ('CLN-MZ-004', 'Dowse Moisturizer', 28),
      ('CLN-MZ-005', 'Avobop Moisturizer', 15),
      ('CLN-MZ-006', 'Uvdox OC Moisturizer', 13),
      ('CLN-SS-001', 'Uvdox Sunscreen', 32),
      ('CLN-SS-002', 'Uvdox OC Sunscreen', 15),
      ('CLN-SS-003', 'Re''equil Bounce Sunscreen', 25),
      ('CLN-SS-004', 'Re''equil Bounce Silicone', 13),
      ('CLN-SS-005', '360' || chr(176) || ' Block Sunscreen', 24),
      ('CLN-SS-006', 'UVSKRIN Silicon Sunscreen', 11),
      ('CLN-SS-007', 'UVSKRIN H2O Water-Based Sunscreen', 12),
      ('CLN-SR-001', 'HA 4 Serum', 19),
      ('CLN-SR-002', 'Acne Face Serum', 19),
      ('CLN-SR-003', 'HA 5 Serum', 5),
      ('CLN-SR-004', 'Retinol Serum VRH', 4),
      ('CLN-SR-005', 'Spotherapy Serum', 17),
      ('CLN-SR-006', 'Dinora Vit C & Glutathione Serum', 11),
      ('CLN-NC-001', 'Yubello', 29),
      ('CLN-NC-002', 'Me-Line', 4),
      ('CLN-NC-003', 'Cicatrix', 3),
      ('CLN-NC-004', 'Plinoromus', 19),
      ('CLN-NC-005', 'Triclear N', 3),
      ('CLN-NC-006', 'Acne Scar', 10),
      ('CLN-NC-007', 'Cuticance', 11),
      ('CLN-NC-008', 'Melanil Cream', 14),
      ('CLN-NC-009', 'Age Defy Tablets', 23),
      ('CLN-NC-010', 'Nrish Tablets', 20),
      ('CLN-NC-011', 'Lip Balm', 14),
      ('CLN-NC-012', 'Avotop Under-Eye', 20),
      ('CLN-NC-013', 'IVI 10', 6),
      ('CLN-HC-001', 'Folisuv Serum', 7),
      ('CLN-HC-002', 'Folisuv Tablets', 1),
      ('CLN-HC-003', 'Minogain Tablets', 9),
      ('CLN-HC-004', 'HDRS Anti-Dandruff Shampoo', 19),
      ('CLN-HC-005', 'Luly ZS Anti-Dandruff Shampoo', 3),
      ('CLN-HC-006', 'Haironomics Hairfall Control Shampoo', 8),
      ('CLN-FC-001', 'Foot Soft', 10)
    ) as sheet(sku, name, qty)
  loop
    select p.id, p.current_stock into match_id, current_qty
    from public.inventory_products p
    where p.workspace_id = clinic_ws
      and p.deleted_at is null
      and (lower(p.sku) = lower(rec.sku) or lower(p.name) = lower(rec.name)
        or (rec.sku = 'CLN-SS-005' and lower(p.name) like '360%block sunscreen%'))
    order by case when lower(p.sku) = lower(rec.sku) then 0 else 1 end
    limit 1;

    if match_id is null then
      insert into public.inventory_products (
        organization_id, workspace_id, name, sku, category, current_stock, minimum_stock,
        purchase_price, selling_price, unit, is_active
      ) values (
        clinic_org, clinic_ws, rec.name, rec.sku, 'Other', rec.qty, 5,
        null, null, 'unit', true
      ) returning id, current_stock into match_id, current_qty;

      insert into public.inventory_transactions (
        organization_id, workspace_id, product_id, transaction_type, quantity, note, previous_quantity, resulting_quantity
      ) values (
        clinic_org, clinic_ws, match_id, 'purchase', rec.qty,
        'Opening stock from clinic inventory sheet', 0, rec.qty
      );

      product_name := rec.name;
      sku := rec.sku;
      current_quantity := 0;
      expected_quantity := rec.qty;
      difference := rec.qty;
      final_quantity := rec.qty;
      action := 'created';
      return next;
      continue;
    end if;

    select count(*) into live_moves
    from public.inventory_transactions t
    where t.product_id = match_id
      and coalesce(t.note, '') not in (
        'Opening stock from clinic inventory sheet',
        'Opening stock from clinic sheet 1 Sep 2026 to 5 Oct 2026',
        'Opening stock',
        'Stock reconciliation to sheet quantities'
      );

    if current_qty = rec.qty then
      act := 'match';
      final_qty := current_qty;
    elsif live_moves > 0 and not p_force then
      act := 'preserve_live';
      final_qty := current_qty;
    else
      perform public.apply_stock_change(
        match_id,
        case when rec.qty >= current_qty then 'purchase' else 'adjustment' end,
        rec.qty - current_qty,
        'Stock reconciliation to sheet quantities'
      );
      act := case when p_force and live_moves > 0 then 'forced_correct' else 'corrected' end;
      final_qty := rec.qty;
    end if;

    product_name := rec.name;
    sku := rec.sku;
    current_quantity := current_qty;
    expected_quantity := rec.qty;
    difference := current_qty - rec.qty;
    final_quantity := final_qty;
    action := act;
    return next;
  end loop;
end;
$$;

revoke all on function public.seed_clinic_inventory_catalogue(uuid) from public, anon;
revoke all on function public.seed_clinic_skincare_stock() from public, anon;
revoke all on function public.reconcile_clinic_inventory_sheet_stock(boolean) from public, anon;

grant execute on function public.seed_clinic_inventory_catalogue(uuid) to authenticated, service_role;
grant execute on function public.seed_clinic_skincare_stock() to authenticated, service_role;
grant execute on function public.reconcile_clinic_inventory_sheet_stock(boolean) to authenticated, service_role;

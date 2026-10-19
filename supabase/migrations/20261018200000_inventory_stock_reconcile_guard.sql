-- Document sheet stock as the opening baseline, and keep the seed from never
-- resetting live quantities on existing products. Reconciliation must not
-- overwrite products that already have real stock movements.

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
  select id, organization_id into clinic_ws, clinic_org
  from public.workspaces
  where workspace_type = 'clinic' and deleted_at is null
  order by created_at
  limit 1;

  if clinic_ws is null then
    return;
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

revoke all on function public.reconcile_clinic_inventory_sheet_stock(boolean) from public, anon;
grant execute on function public.reconcile_clinic_inventory_sheet_stock(boolean) to authenticated, service_role;

-- Dry-run style call with force=false: correct only untouched mismatches, preserve live stock.
select * from public.reconcile_clinic_inventory_sheet_stock(false);

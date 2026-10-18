-- Clinic inventory catalogue: SKU, nullable prices, images, stock history fields,
-- product-images storage, and idempotent seed of 44 clinic products.

alter table public.inventory_products
  add column if not exists sku text not null default '',
  add column if not exists description text not null default '',
  add column if not exists image_path text not null default '',
  add column if not exists is_active boolean not null default true,
  add column if not exists requires_name_verification boolean not null default false;

alter table public.inventory_products
  alter column purchase_price drop not null,
  alter column selling_price drop not null;

update public.inventory_products
set purchase_price = null
where purchase_price = 0;

update public.inventory_products
set selling_price = null
where selling_price = 0;

alter table public.inventory_products
  drop constraint if exists inventory_products_stock_nonneg;
alter table public.inventory_products
  add constraint inventory_products_stock_nonneg check (current_stock >= 0);

alter table public.inventory_products
  drop constraint if exists inventory_products_min_nonneg;
alter table public.inventory_products
  add constraint inventory_products_min_nonneg check (minimum_stock >= 0);

create unique index if not exists inventory_products_workspace_sku_uidx
  on public.inventory_products (workspace_id, lower(sku))
  where deleted_at is null and sku <> '';

alter table public.inventory_transactions
  add column if not exists previous_quantity numeric(12, 2),
  add column if not exists resulting_quantity numeric(12, 2);

create or replace function public.apply_stock_change(product uuid, kind text, qty numeric, note text default '')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  org uuid;
  ws uuid;
  stock numeric;
  next_stock numeric;
begin
  select organization_id, workspace_id, current_stock
  into org, ws, stock
  from public.inventory_products
  where id = product and deleted_at is null
  for update;

  if org is null then
    raise exception 'Product not found';
  end if;

  next_stock := stock + qty;
  if next_stock < 0 then
    raise exception 'Stock cannot go below zero';
  end if;

  insert into public.inventory_transactions (
    organization_id, workspace_id, product_id, transaction_type, quantity, note, created_by, previous_quantity, resulting_quantity
  ) values (
    org, ws, product, kind, qty, coalesce(note, ''), auth.uid(), stock, next_stock
  );

  update public.inventory_products
  set current_stock = next_stock, updated_at = now()
  where id = product;
end;
$$;

grant execute on function public.apply_stock_change(uuid, text, numeric, text) to authenticated;

create or replace function public.confirm_inventory_stock_out(
  p_workspace uuid,
  p_items jsonb,
  p_reason text default 'Cart stock-out',
  p_kind text default 'sale'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  product_id uuid;
  qty numeric;
  available numeric;
  active boolean;
  sold numeric := 0;
begin
  if p_kind not in ('sale', 'treatment', 'adjustment') then
    raise exception 'Unsupported stock-out type';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    product_id := (item->>'product_id')::uuid;
    qty := greatest(0, coalesce((item->>'quantity')::numeric, 0));
    if qty <= 0 then
      raise exception 'Invalid quantity';
    end if;

    select current_stock, is_active
    into available, active
    from public.inventory_products
    where id = product_id
      and workspace_id = p_workspace
      and deleted_at is null
    for update;

    if available is null then
      raise exception 'Product not found';
    end if;
    if not active then
      raise exception 'Inactive products cannot be issued';
    end if;
    if available < qty then
      raise exception 'Insufficient stock for one or more products';
    end if;

    perform public.apply_stock_change(product_id, p_kind, -qty, coalesce(nullif(trim(p_reason), ''), 'Cart stock-out'));
    sold := sold + qty;
  end loop;

  return jsonb_build_object('ok', true, 'units', sold);
end;
$$;

grant execute on function public.confirm_inventory_stock_out(uuid, jsonb, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_read on storage.objects;
drop policy if exists product_images_insert on storage.objects;
drop policy if exists product_images_update on storage.objects;
drop policy if exists product_images_delete on storage.objects;

create policy product_images_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  );

create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.workspaces w
        where w.id = split_part(name, '/', 2)::uuid
          and (public.is_org_admin(w.organization_id) or exists (
            select 1 from public.workspace_role_keys(w.id) k where k in ('doctor', 'admin')
          ))
      )
    )
  );

create policy product_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  )
  with check (
    bucket_id = 'product-images'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  );

create policy product_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.workspaces w
        where w.id = split_part(name, '/', 2)::uuid
          and (public.is_org_admin(w.organization_id) or exists (
            select 1 from public.workspace_role_keys(w.id) k where k in ('doctor', 'admin')
          ))
      )
    )
  );

create or replace function public.seed_clinic_inventory_catalogue()
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
  select id, organization_id into clinic_ws, clinic_org
  from public.workspaces
  where workspace_type = 'clinic' and deleted_at is null
  order by created_at
  limit 1;

  if clinic_ws is null then
    return 0;
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

revoke all on function public.seed_clinic_inventory_catalogue() from public, anon;
grant execute on function public.seed_clinic_inventory_catalogue() to authenticated, service_role;

select public.seed_clinic_inventory_catalogue();

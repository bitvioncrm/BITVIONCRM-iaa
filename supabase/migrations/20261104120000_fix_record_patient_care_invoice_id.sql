create or replace function public.record_patient_care(
  p_patient uuid,
  p_doctor uuid,
  p_procedure_1 text,
  p_procedure_2 text,
  p_performed_on date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  patient public.patients%rowtype;
  visit_id uuid;
  item jsonb;
  product_id uuid;
  product_name text;
  qty numeric;
  price numeric;
  stock numeric;
  active boolean;
  line numeric;
  total numeric := 0;
  bill_id uuid;
  bill_no text;
  old_discount numeric := 0;
  old_total numeric := 0;
  paid_so_far numeric := 0;
  new_total numeric;
  due numeric;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into patient from public.patients where id = p_patient and deleted_at is null;
  if patient.id is null then
    raise exception 'Patient not found';
  end if;
  if not public.can_use_clinic(patient.workspace_id) then
    raise exception 'This desk cannot record treatment';
  end if;

  insert into public.patient_procedures (
    organization_id, workspace_id, patient_id, doctor_id, procedure_1, procedure_2, performed_on, notes, created_by
  ) values (
    patient.organization_id,
    patient.workspace_id,
    patient.id,
    p_doctor,
    trim(coalesce(p_procedure_1, '')),
    trim(coalesce(p_procedure_2, '')),
    coalesce(p_performed_on, current_date),
    trim(coalesce(p_notes, '')),
    auth.uid()
  )
  returning id into visit_id;

  if jsonb_typeof(p_items) = 'array' then
    for item in select * from jsonb_array_elements(p_items)
    loop
      product_id := nullif(item->>'product_id', '')::uuid;
      qty := greatest(0, coalesce((item->>'quantity')::numeric, 0));
      if product_id is null or qty <= 0 then
        continue;
      end if;

      select current_stock, is_active, coalesce(selling_price, 0), name
      into stock, active, price, product_name
      from public.inventory_products
      where id = product_id
        and workspace_id = patient.workspace_id
        and deleted_at is null
      for update;

      if stock is null then
        raise exception 'Product not found';
      end if;
      if active is false then
        raise exception 'Inactive products cannot be issued';
      end if;
      if stock < qty then
        raise exception 'Not enough stock';
      end if;

      if item ? 'unit_price' and nullif(item->>'unit_price', '') is not null then
        price := greatest(0, (item->>'unit_price')::numeric);
      end if;

      line := round(price * qty, 2);
      total := total + line;

      insert into public.inventory_transactions (
        organization_id, workspace_id, product_id, transaction_type, quantity, note, created_by, previous_quantity, resulting_quantity
      ) values (
        patient.organization_id, patient.workspace_id, product_id, 'treatment', -qty,
        'Used for patient care', auth.uid(), stock, stock - qty
      );

      update public.inventory_products
      set current_stock = stock - qty, updated_at = now()
      where id = product_id;

      insert into public.patient_procedure_items (procedure_id, product_id, quantity, unit_price, line_total)
      values (visit_id, product_id, qty, price, line);

      if bill_id is null then
        select i.id, i.invoice_number, coalesce(i.discount, 0), coalesce(i.total, 0)
        into bill_id, bill_no, old_discount, old_total
        from public.invoices i
        where i.patient_id = patient.id
          and i.workspace_id = patient.workspace_id
          and i.status not in ('cancelled', 'refunded')
        order by i.issued_on desc, i.created_at desc
        limit 1;

        if bill_id is null then
          bill_no := 'INV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
          insert into public.invoices (
            organization_id, workspace_id, invoice_number, patient_id, discount, total, issued_on, status, created_by
          ) values (
            patient.organization_id, patient.workspace_id, bill_no, patient.id, 0, 0, current_date, 'pending', auth.uid()
          )
          returning id into bill_id;
          old_discount := 0;
          old_total := 0;
        end if;

        select coalesce(sum(p.amount), 0) into paid_so_far
        from public.payments p
        where p.invoice_id = bill_id;
      end if;

      insert into public.invoice_items (invoice_id, description, quantity, unit_price)
      values (bill_id, 'Product · ' || coalesce(nullif(trim(product_name), ''), 'Product'), qty, price);
    end loop;
  end if;

  update public.patient_procedures set product_total = total where id = visit_id;

  if bill_id is not null then
    new_total := round(old_total + total, 2);
    due := greatest(0, new_total - paid_so_far);
    update public.invoices
    set
      total = new_total,
      status = case
        when paid_so_far <= 0 then 'pending'
        when due <= 0 then 'paid'
        else 'partial'
      end
    where id = bill_id;
  end if;

  return visit_id;
end;
$$;

revoke all on function public.record_patient_care(uuid, uuid, text, text, date, text, jsonb) from public, anon;
grant execute on function public.record_patient_care(uuid, uuid, text, text, date, text, jsonb) to authenticated;

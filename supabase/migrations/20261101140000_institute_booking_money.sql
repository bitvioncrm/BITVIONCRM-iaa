drop policy if exists invoices_institute on public.invoices;
create policy invoices_institute on public.invoices
  for all to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

drop policy if exists payments_institute on public.payments;
create policy payments_institute on public.payments
  for all to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

drop policy if exists invoice_items_institute on public.invoice_items;
create policy invoice_items_institute on public.invoice_items
  for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_use_institute(i.workspace_id)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_use_institute(i.workspace_id)));

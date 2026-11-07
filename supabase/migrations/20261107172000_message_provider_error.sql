alter table public.messages
  add column if not exists provider_error text;

comment on column public.messages.provider_error is 'WhatsApp Cloud API webhook failure detail for outbound delivery.';

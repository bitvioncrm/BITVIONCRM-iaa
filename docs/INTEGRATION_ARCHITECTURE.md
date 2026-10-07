# Integrations

Core CRM and ERP do not import Meta, WhatsApp, or AI clients. Those sit behind adapters.

| Adapter | Official API | When disconnected |
| --- | --- | --- |
| `MetaAdapter` | Graph API and Page `leadgen` webhook. Instagram messaging for the connected professional account | Lead forms and DMs show **Not Connected**. Manual lead entry still works |
| `WhatsAppAdapter` | WhatsApp Cloud API. Templates, media, status webhooks | Clinic automation shows **Configuration Required**. Staff can still use `tel:` and record nothing fake in a thread |
| `AIAdapter` | Optional. Off unless a local or configured model exists | Scoring and OCR stay empty. Uploads still store |

No adapter exists for payments, telephony, email, or SMS.

## Webhook path

Meta or WhatsApp calls a Netlify function. The function checks the verify token or signature, inserts `processed_events` with `external_event_id`. A unique violation means the event was already handled and the function returns success without creating a second lead or message. The function uses the Supabase service role, which is only in Netlify environment variables, never in `VITE_` variables.

Workspace mapping uses the form id or campaign id stored in configuration, not a hardcoded Perumbavoor string.

## Secrets

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may ship in the frontend. Service role key, Meta app secret, page token, and WhatsApp token are server-only.

## Call time and payments

Not integrations. Start Call / End Call updates `call_time_sessions` and `call_time_days`. Payment entry inserts `payments` with method cash, UPI, card, bank transfer, or online payment as a label on the row.

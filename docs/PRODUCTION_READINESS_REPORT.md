# Production readiness report

Date: 2026-10-07.

This is not a 100% production-ready system. The application builds, the unit tests pass, and the signed-in path talks to Supabase when environment variables exist. No live Supabase project was available in this workspace, so migrations were not applied and the clinic and institute workflows were not executed against PostgreSQL.

Completion, based on working database plus security plus UI plus tests, not on screen count: **48%**.

## Actual completed functionality

- Supabase Auth sign-up, sign-in, session restore, sign-out, and password-reset request. Demo passwords are not accepted.
- A Supabase session does not write leads, patients, or invoices to `bitvion.crm.v7`. The production shell no longer builds the 1,248-lead seed.
- Role gates for the seven roles hide and block routes in the app shell. This is not a substitute for RLS.
- Lead list, create, update, assign, delete, notes, follow-ups, and CSV/XLSX import call PostgreSQL with server-side paging.
- Call time stores only a completed Start to End duration. Interrupted sessions store no duration. The math is unit-tested.
- Clinic forms cover patient fields, a selected doctor, walk-in arrival, appointment status changes, consultation, and prescription lines.
- Opening stock is a purchase transaction. Later stock changes go through `apply_stock_change`.
- Invoices, payments, and refunds are native. There is no payment gateway.
- Institute forms cover admission, exams, marks, certificates, and private file upload.
- WhatsApp send is a Netlify function that calls the Cloud API only when the token and phone number id exist, and only for a lead assigned to the signed-in user. Otherwise it returns configuration required or forbidden.
- Meta lead webhook verifies the signature, stores idempotency, and can round-robin assign when `META_ASSIGNMENT=round_robin` and `next_bde` exists.
- Automation tick returns 503 when the WhatsApp token is missing. It does not record a sent message.

## Actual incomplete functionality

- Migrations have not been applied. RLS has not been proven with a cross-workspace request.
- Scenarios for clinic conversion and institute admission were not run.
- Admin granular permissions are seeded in SQL. The UI does not yet let Super Admin toggle each Admin permission.
- Kanban drag-and-drop still is not the production pipeline. Production uses a stage dropdown on one page of leads.
- Lead merge is a SQL function. The screen does not call it yet. Related notes, follow-ups, messages, patients, and students are moved by that function once it is applied.
- Follow-up today, overdue, and upcoming buckets are not a dedicated production dashboard query.
- Batch management, PDF optimization, and document preview are incomplete.
- Inventory low-stock and expiry alerts are not a report.
- Revenue date presets exist as a helper. The reports screen still asks for a manual range and fails until `revenue_totals` is applied.
- Automation does not wait, check a reply, and send a second template. Stop-on-reply is a tested decision function, not a running worker.
- Outbound WhatsApp has no inbox. Delivery and read status are updated only by the inbound webhook.
- Signup does not create the organization, workspaces, or the other six roles. The first Auth user becomes Super Admin only if the phase 1 trigger is applied.
- `src/data/catalog.ts` still contains demo passwords for the unused seed. Login does not read them.
- `loadCrm()` still seeds the browser when there is no Supabase session. That path is unreachable after the demo login was removed, but the seed code remains in the bundle.

## Database and migrations

Files, in order, not applied here:

1. `supabase/migrations/20261007000000_phase1_tenancy.sql`
2. `supabase/migrations/20261007120000_phase2_leads.sql`
3. `supabase/migrations/20261007140000_phase3_erp.sql`
4. `supabase/migrations/20261007180000_phase4_audit_fixes.sql`
5. `supabase/migrations/20261007200000_phase5_workflows.sql`

`merge_leads` preserves notes, follow-ups, assignments, status history, messages, patient links, and student links, then soft-deletes the duplicate. `next_bde` is executable by the service role only.

## RLS, roles, and security

Policies exist for workspace membership, assigned leads, clinic vs institute helpers, doctor-linked patients, and counsellor-linked students. None of that was executed. Frontend route checks were tested as pure functions only.

The service role key is not in `src/`. Meta and WhatsApp secrets are read in Netlify functions.

## Module verification

| Area | Result |
| --- | --- |
| CRM | Code calls Postgres. Not verified by a second session. |
| Call time | Math tested. No persisted row. |
| Clinic ERP | Forms write the tables. Not verified. |
| Institute ERP | Forms write the tables. Batches have no screen. |
| Inventory | Purchase transaction on opening stock. Negative stock rule is in the unapplied migration. |
| Billing | Invoice, payment, refund code. Not recalculated against a database. |
| Revenue | SQL aggregate exists and is unapplied. |
| Documents | Private upload and hash. No preview. Storage policies unapplied. |
| Meta | Webhook code only. Not connected. |
| WhatsApp | Send and inbound webhook code only. Not connected. |
| Automation | Tick function refuses to send without a token. No wait/follow-up loop. |
| Reporting | Manual revenue range. Other reports are not SQL. |
| Audit | Lead and patient actions insert rows. Not append-only until the phase 4 migration is applied. |
| Performance | Lead queries use `range`. The main bundle is still about 1.2 MB because the seed and `xlsx` are compiled. |

## Tests, build, lint

- `npm test` passed: lead rules, call time and money, production boundary, role and automation rules.
- `npm run build` passed.
- `npx oxlint src` was run in the same session as this report. Warnings remain. There were no errors.

## Deployment and external configuration

Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Server only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `META_APP_SECRET`, `META_PAGE_TOKEN`, `META_VERIFY_TOKEN`, `META_ORGANIZATION_ID`, `META_WORKSPACE_ID`, `META_ASSIGNMENT` (`round_robin` or empty), `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ORGANIZATION_ID`, `WHATSAPP_WORKSPACE_ID`, `AUTOMATION_SECRET`.

Netlify functions:

- `/.netlify/functions/meta-leadgen`
- `/.netlify/functions/whatsapp-webhook`
- `/.netlify/functions/whatsapp-send`
- `/.netlify/functions/automation-tick`

Apply the five SQL files, create both workspaces, assign the seven roles, then run the clinic and institute scenarios before treating this as production.

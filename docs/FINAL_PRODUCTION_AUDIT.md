# Final production audit

Date: 2026-10-07. This audit inspected the repository. It did not run against a live Supabase project, so no feature below is marked production complete.

A feature is production complete only when the database, backend, RLS, authorization, UI, validation, errors, and tests all work together on a real project. That bar was not met.

## Classification

| Feature | Class | Why |
| --- | --- | --- |
| Supabase Auth login, logout, session restore, password reset request | B. Partial | Code uses `signInWithPassword`, `getSession`, `signOut`, and `resetPasswordForEmail`. There is no signup screen. Reset depends on Supabase email settings. Not exercised against a project. |
| Demo passwords `admin123` / `staff123` | Fixed in this pass | Login no longer accepts `DEMO_ACCOUNTS`. The login screen no longer prints those passwords. |
| Browser CRM store `bitvion.crm.v7` | C. Demo only, no longer the signed-in path | `src/services/storage.ts` still contains the key and seed. A Supabase session does not write it. `idleCrm()` still builds the seed in memory and then drops business rows. |
| Seven roles | B. Partial | Seeded in phase 1 SQL. The UI collapses them to administrator vs counsellor. RLS helpers exist. Role behavior was not executed. |
| Organization and workspace isolation | B. Partial | `organization_id` / `workspace_id` and RLS policies exist, including a new doctor and institute-user read policy. Not tested with direct API calls. |
| Leads CRUD, search, filter, pagination, notes, follow-ups, import | B. Partial | Services page 20 rows and import in batches. Persistence was not verified by refresh on another session. Merge does not move related rows. |
| Pipeline drag-and-drop | B. Partial | Production users get a stage dropdown that updates PostgreSQL for one page of leads. The demo kanban is not the production path. |
| Call time | B. Partial | Start/End stores elapsed seconds only. Invalid timers return null. Unit tests cover the math. No live row was written. |
| Tasks | B. Partial | Create and list against `tasks`. Status workflow is thin. |
| Clinic patients, appointments, walk-in, consultation, prescription | B. Partial | Forms write the phase 3 tables. Doctor is chosen, not forced to the current user. Walk-in sets status `arrived`. |
| Inventory | B. Partial | Opening stock is a purchase transaction. Later changes go through `apply_stock_change`. The new migration refuses negative stock. Not applied here. |
| Billing and refunds | B. Partial | Invoice, cash payment, and refund insert. No gateway. Not refreshed against Postgres in this audit. |
| Revenue | B. Partial | `revenue_totals` aggregates invoices, payments, and refunds and checks `can_view_money`. The reports screen calls that function. It errors until the new migration is applied. |
| Institute students, exams, marks, certificates, documents | B. Partial | Forms exist. Batch management has a table and no screen. |
| Documents | B. Partial | Private bucket, SHA-256 reuse, image resize for photos. PDF and Office files are stored unchanged. Signed URL helper exists. Preview UI does not. Storage policies are in the new migration and are not applied. |
| Meta Lead Ads | D. Not implemented as a live integration | Webhook validates a signature and returns 503 without secrets. It does not show Connected. |
| WhatsApp Cloud API | D. Not implemented as a live integration | Inbound webhook only. No send, inbox, templates, or media. Production WhatsApp page says Configuration Required. |
| Automation | D. Not implemented | Tables exist. No worker sends a template or stops on reply. A unique index is in the new migration only. |
| Audit log | B. Partial | Append-only revoke is in the new migration. Lead create, assign, and delete write a row. Login, invoices, and stock do not all write one. |
| Reports | B. Partial | Revenue range only. Lead, BDE, and call-time reports are not SQL reports. |
| AI | D. Not implemented | Interface only. |

Nothing is class A. Nothing in the signed-in path is class E from the TypeScript build. Class F items are listed under security.

## 1. Completed in this audit pass

- Sign-in requires Supabase Auth. Demo passwords are not accepted.
- A Supabase session does not save business data to `bitvion.crm.v7`.
- Password reset calls Supabase instead of telling the user a demo password.
- Opening stock creates a purchase transaction.
- Appointments take a doctor id. Walk-in can be marked arrived.
- Exams, marks, certificates, student file upload, and refunds have forms.
- Production pipeline, tasks, reports, audit, and settings no longer use the demo store or a fake Meta connected switch.
- New migration `supabase/migrations/20261007180000_phase4_audit_fixes.sql` for doctor and student reads, append-only audit, stock floor, revenue aggregate, automation uniqueness, and private storage policies.
- `npm test` and `npm run build` succeeded.

## 2. Partial

Everything in the table marked B.

## 3. Missing

- Signup and invite UI for the seven roles.
- Live RLS tests for organization, clinic vs institute, BDE, doctor, and institute user.
- End-to-end clinic and institute scenarios on a real database.
- Pipeline drag-and-drop persistence.
- Lead merge that moves notes, follow-ups, messages, and appointments.
- Batch screens, PDF optimization, document preview.
- Outbound WhatsApp, templates, inbox, and stop-on-reply.
- Automation worker.
- Full audit coverage.
- Verified import of 12,000 leads.

## 4. Broken

- Revenue and the new doctor, student, storage, and stock rules do nothing until `20261007180000_phase4_audit_fixes.sql` is applied after the three earlier migrations.
- `idleCrm()` still runs the demo seed builder on each production session, then throws the business rows away. That wastes memory. It does not persist them.

## 5. Security issues

- `security definer` helpers remain in `public` from phases 1–3. They use `auth.uid()` and a fixed `search_path`. They were not moved, because rewriting applied functions in place is unsafe.
- Invoice rows are still readable by clinic roles that `can_use_clinic` allows. Revenue totals are blocked unless `can_view_money` passes, after the new migration.
- Service role and Meta secrets appear only in Netlify functions and `.env.example` comments. They are not in `src/`.
- RLS was not proven by a cross-workspace request. Policies are not a test result.
- Old demo passwords remain in `src/data/catalog.ts` for the unused seed. They are not a login path.

## 6. Database issues

- Four migration files exist. None were applied in this environment.
- `processed_events` has no insert policy for `authenticated`. Webhooks use the service role, which bypasses RLS.
- Audit insert policy allows the actor to insert their own row. Update and delete are revoked only in the new migration.

## 7. UI issues

- Production clinic, institute, inventory, and billing screens are forms, not the original demo layout.
- One lead page is loaded on the production pipeline. It does not virtualize 30,000 cards.
- The main bundle is about 1.2 MB before gzip because the seed and `xlsx` are still compiled.

## 8. Integration issues

- Meta and WhatsApp functions return `configuration_required` when secrets are missing. That is intentional.
- No Graph token, WhatsApp token, or webhook was called.

## 9. Performance issues

- Lead list uses `range` and a count. It does not download every lead.
- Revenue no longer pulls every invoice into the browser. It calls `revenue_totals`.
- `idleCrm()` still constructs the full seed once per signed-in session.
- Import still parses the whole sheet before batching.

## 10. Required manual configuration

1. Create a Supabase project.
2. Run, in order:
   - `supabase/migrations/20261007000000_phase1_tenancy.sql`
   - `supabase/migrations/20261007120000_phase2_leads.sql`
   - `supabase/migrations/20261007140000_phase3_erp.sql`
   - `supabase/migrations/20261007180000_phase4_audit_fixes.sql`
3. Confirm bucket `documents` is private.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the browser.
5. Create the first Auth user. The phase 1 trigger grants super admin.
6. Create the organization, clinic workspace, and institute workspace, then assign the seven roles in `user_roles`.
7. Sign in, create a lead, refresh, and confirm it is not in `bitvion.crm.v7`.

## 11. Deployment requirements

- Netlify: `npm run build`, publish `dist`, functions in `netlify/functions`, Node 22.
- Server variables, never `VITE_`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `META_PAGE_TOKEN`, `META_VERIFY_TOKEN`, `META_ORGANIZATION_ID`, `META_WORKSPACE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ORGANIZATION_ID`, `WHATSAPP_WORKSPACE_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, template names.
- Without those, webhooks stay at 503. Do not treat that as connected.

## Acceptance scenarios

Scenario A and Scenario B were not run. There is no live project in this environment, so a lead was not created, a call was not timed in Postgres, and clinic and institute rows were not isolated by a real request.

## Scorecard

These percentages are implementation and verification, not screen count.

| Area | Score |
| --- | --- |
| Authentication | 55% |
| RBAC | 40% |
| Multi-tenancy | 45% |
| CRM | 50% |
| Call-time | 60% |
| Clinic ERP | 45% |
| Institute ERP | 40% |
| Inventory | 50% |
| Billing | 45% |
| Revenue | 35% |
| Documents | 30% |
| Meta | 15% |
| WhatsApp | 15% |
| Automation | 10% |
| Reporting | 25% |
| Security | 40% |
| Testing | 20% |
| Deployment readiness | 30% |
| **Overall** | **35%** |

The system is not production ready.

# Implementation roadmap

Do not treat a screen as done until the table, RLS, validation, and empty/error states exist. The demo UI stays until that phase is verified.

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Audit and architecture documents | Done in `docs/` |
| 1 | Supabase tenancy, Auth profile trigger, roles, permissions, RLS, frontend client, configuration-required banner | Code written. Not applied to a live Supabase project in this environment |
| 2 | Leads in PostgreSQL, assignment, notes, follow-ups, server pagination, CSV/XLSX import | Code written. Persistence is unverified until migrations run |
| 3 | Call-time Start/End, tasks table, follow-up list | Code written. Live timer is display-only until End Call |
| 4 | Patients, appointments, consultations, prescriptions, inventory transactions, invoices, payments | Code written. UI is operational forms, not the full demo screens |
| 5 | Students, courses, admissions. Exams, marks, and certificates have tables only | Partial |
| 6 | Private bucket, SHA-256, image resize for photos | Partial. No document screen |
| 7 | Meta leadgen function | Code written. Returns 503 until server secrets exist. Not connected |
| 8 | WhatsApp webhook stores inbound messages and status | Code written. Returns 503 until server secrets exist. Sending is not connected |
| 9 | AI adapter interface only | Not used. Core app does not call AI |
| 10 | Revenue summary from invoices | Partial. Role dashboards are not all separate screens |
| 11 | Import workflow for an old CRM export | Same importer as phase 2. No verified 12,000-row load |
| 12 | Unit tests for phone rules, call time, and money. RLS not executed against Postgres | Not a production pass |

## Phase 1 exit criteria

- Migration applies on a new Supabase project.
- First signup becomes Super Admin.
- A second user without a role cannot read another organization's rows.
- The app builds with no Supabase env and shows **Configuration Required** for the production database.
- Service role key is not referenced in `src/`.

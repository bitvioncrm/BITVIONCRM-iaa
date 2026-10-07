# Database schema

PostgreSQL on Supabase. Phase 1 migration creates tenancy, roles, and audit. Later migrations add CRM and ERP tables. All business tables include `organization_id` and `workspace_id` where the row belongs to a workspace, plus `created_by`, `updated_by`, `created_at`, `updated_at`, and for recoverable entities `deleted_at` and `deleted_by`.

## Phase 1 (implemented in `supabase/migrations`)

- `organizations`
- `workspaces` (`workspace_type` text, not a closed clinic/institute enum)
- `workspace_modules` (`module_key`, `enabled`)
- `profiles` (one row per `auth.users`)
- `roles`
- `permissions`
- `role_permissions`
- `user_roles` (`organization_id` and `workspace_id` nullable for Super Admin)
- `audit_logs` (append-only)

The first Auth user is granted `super_admin` by the signup trigger. Later users get no role until an admin assigns one.

## Phase 2 CRM

`lead_stages` (configurable labels, ordered), `lead_sources`, `leads`, `lead_assignments`, `lead_status_history`, `lead_notes`, `lead_tags`, `followups`, `tasks`, `campaigns`, `message_templates`.

Call time, minimum columns only:

- `call_time_days`: `organization_id`, `workspace_id`, `user_id`, `day`, `actual_seconds`, `target_seconds`
- `call_time_sessions`: `id`, `user_id`, `workspace_id`, `started_at`, `ended_at`, `duration_seconds`, `status` (`active`, `completed`, `interrupted`)

No call outcome, no recording, no provider id. Dashboard sums `duration_seconds` where `status = completed`.

## Phase 4 clinic

`patients`, `appointments`, `consultations`, `prescriptions`, `treatments`, `inventory_products`, `inventory_transactions`, `suppliers`, `invoices`, `invoice_items`, `payments`, `refunds`.

Revenue is `sum(invoice totals) - discounts - refunds`. It is never counted from lead rows. Payment methods are configuration rows: cash, UPI, card, bank transfer, online payment. Recording a payment does not call a gateway.

## Phase 5 institute

`courses`, `batches`, `admissions`, `students`, `exams`, `marks`, `certificates`.

## Shared

`documents`, `file_versions`, `file_processing_jobs`, `notifications`, `automation_rules`, `automation_runs`, `processed_events` (`external_event_id` unique), `jobs`.

Lead to person: `leads.patient_id` or `leads.student_id` set on conversion. Appointments reference `patient_id`. Admissions reference `student_id`. Invoices reference one of those plus optional `appointment_id`.

## Indexes

Phone and email on leads and patients, normalized (digits-only phone, lowercased email). Unique `(organization_id, workspace_id, phone_normalized)` where phone is present, used to surface duplicates rather than to delete them. Partial indexes exclude `deleted_at is not null`. Foreign keys on every relation listed above.

## Import

CSV and XLSX are parsed in batches on the server (Netlify function or a Postgres function fed by chunks). The browser sends mapped rows in batches and never holds 30,000 full records as React state. Duplicate policy per row: merge, skip, or import separately. Merge keeps notes, follow-ups, appointments, and messages.

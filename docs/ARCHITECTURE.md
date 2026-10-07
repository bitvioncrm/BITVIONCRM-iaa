# Architecture

BITVION is one React application. PostgreSQL on Supabase is the source of truth once configured. The browser is not.

```
Organization
  Workspace (type + enabled modules)
    Department / desk
      Users
        Roles
          Permissions
```

Clinic, institute, hospital, academy, and other workspace types are rows, not branches of the code. Modules turn on per workspace: CRM, appointments, patients, inventory, billing, admissions, courses, WhatsApp, Meta, and the rest.

## Layers

| Layer | Responsibility |
| --- | --- |
| React routes and pages | Role dashboards, forms, empty and error states |
| Supabase Auth | Login, logout, session, password reset |
| PostgreSQL | Leads, ERP records, call-time totals, files metadata, jobs |
| Row level security | Organization and workspace isolation, role limits |
| Storage buckets | Private files, signed URLs |
| Netlify | Static app and webhook/job HTTP endpoints |
| Adapters | Meta, WhatsApp, AI. Core CRM and ERP run when these are disconnected |

There is no payment gateway and no telephony provider. Payments are rows. Call time is a timer duration added to a BDE total.

## Data rule

A lead converts to a patient or a student. An appointment or admission points at that person. An invoice points at the service or course. A payment points at the invoice. Documents point at `entity_type` and `entity_id`. Activity rows point at the same pair. Call-time storage stays a total per BDE, workspace, and day. It is not a call-history module.

## Frontend state

Server data loads in pages, filtered and paginated in Postgres. Local component state is for the open form and the running call timer. `localStorage` may hold non-sensitive UI preferences only. The demo key `bitvion.crm.v7` remains until the Supabase path is verified, and the shell labels that mode as configuration required.

## Integrations

Meta and WhatsApp enter through Netlify functions. Each delivery stores `external_event_id` and is ignored on replay. If the adapter is not configured, screens show **Not Connected** or **Configuration Required**. Lead capture, assignment, notes, and ERP recording continue.

## Call time

Start Call writes `started_at` for the signed-in BDE. End Call sets `ended_at`, stores `duration_seconds = ended_at - started_at`, and adds that number to the daily total. The dashboard shows today, target, remaining (`max(target - actual, 0)`), week, and month. An open timer is not part of the total. A dropped session is marked interrupted and is not given a guessed duration.

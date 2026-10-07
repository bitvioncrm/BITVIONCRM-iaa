# Project audit

Date: 7 Oct 2026. Repository: BITVION CRM. This file records what exists before the production foundation. It does not mark unfinished modules as complete.

## Stack

React 19, TypeScript, Vite 8, Tailwind 4, React Router 7. UI is hand-rolled around Radix. Charts use Recharts. Forms use React Hook Form and Zod. Drag and drop uses dnd-kit. Hosting config is `netlify.toml` (build `npm run build`, publish `dist`, functions `netlify/functions`). There is no Supabase client, no SQL migration, and no function implementation.

## Source of truth today

`src/services/storage.ts` reads and writes `localStorage` key `bitvion.crm.v7`. `src/data/seed.ts` builds about 1,248 leads, calls, tasks, and messages when that key is missing. `src/context/CrmContext.tsx` keeps the whole book in memory and persists it on every change. `src/context/AuthContext.tsx` checks email and password against `DEMO_ACCOUNTS` in `src/data/catalog.ts` and stores the session in `localStorage` or `sessionStorage` (`recruitflow.session`).

This is a single-browser demo. It is not multi-tenant, not shared across staff phones, and not a production database.

## Routes (`src/App.tsx`)

`/login`, `/` dashboard, `/desk`, `/leads`, `/leads/:id`, `/pipeline`, `/follow-ups`, `/calls`, `/whatsapp`, `/campaigns`, `/templates`, `/tasks`, `/reports`, `/team`, `/activity`, `/settings`.

## What is useful and should be preserved

- Two-desk idea: clinic and institute, with admin seeing both and staff limited by `src/lib/scope.ts`.
- Lead stages in `STATUS_LABEL` / `STATUS_ORDER`: New, Contacted, Interested, Follow-up, Details Pending, In Progress, Consultation, Booked, Converted, Lost.
- Stage text mapping in `stageFromText` (`src/data/catalog.ts`).
- CSV import column mapping and Excel-safe export (`src/components/leads/ImportDialog.tsx`, `src/lib/lead-export.ts`, `src/lib/csv.ts`).
- Dashboard day, month, and year filter (`src/lib/day-filter.ts`).
- Phone links via `tel:` (`src/components/shared/PhoneLink.tsx`).
- Pipeline board, follow-ups, tasks, templates, campaigns, reports, team, and activity screens.
- BITVION logo assets in `public/`.
- Netlify SPA redirect.

Clinic and institute names, Perumbavoor, and IAA Kochi are hardcoded in catalog, seed, and several pages. The production model treats those as the first workspace configuration, not as code constants.

## What is simulated

| Area | Current behaviour |
| --- | --- |
| Auth | Fixed demo passwords `admin123` and `staff123` |
| Database | Entire CRM JSON in localStorage |
| Calls | Seeded `calls` with generated durations. This conflicts with the production rule: call time comes only from a Start / End timer |
| WhatsApp | Messages are written into local state. Settings says the Cloud API is not connected |
| Meta | Settings can mark an account "connected" with no token and no webhook |
| Revenue, patients, inventory, doctors, receptionist, students | Not present |
| Documents | Lead document slots in the type model, stored inside the JSON blob |

## Roles today

`administrator`, `manager`, `counsellor`, `viewer` in `src/types/index.ts`. Access flags live on each user (`viewAllLeads`, `assignLeads`, and others). Staff navigation is Dashboard, Leads, Calls, WhatsApp (`src/components/layout/nav.ts`). Enforcement is in the React tree only. There is no database policy.

## Gaps against the production spec

No organizations, workspaces, RLS, Supabase Auth, patients, appointments, billing, inventory, institute academics, file pipeline, idempotent webhooks, audit log table, or call-time totals sourced from a timer. Pagination exists as a component, but the lead list still holds the full array in memory.

## Rule for the next edits

Do not delete the demo path until a signed-in Supabase session can read and write the same workflow. Until `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, the interface must say the production database is configuration required, and the existing screens keep working.

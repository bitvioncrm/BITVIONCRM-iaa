# Migration plan

## From the demo

The demo database is `localStorage` key `bitvion.crm.v7`, seeded with about 1,248 leads. Staff passwords are not migrated. Real users are created in Supabase Auth.

Order:

1. Apply `supabase/migrations` on an empty project.
2. Sign up the first user. The trigger grants `super_admin`.
3. Super Admin creates the organization and workspaces (clinic and institute are data).
4. Keep the React demo available until a production lead can be created, listed, and isolated by RLS.
5. After that verification, stop writing new business data to `bitvion.crm.v7`. Export any leads the client typed into the demo through the existing CSV export, then import them with the batch importer.

Do not drop demo code in the same change that adds the first SQL file.

## From the client's old CRM (12,000+ leads)

Upload CSV or XLSX. Preview headers. Map columns to lead fields, workspace, BDE, and stage (`stageFromText` rules: Converted, Booked, Consultation, Details Pending, and the other labels). Normalize phone to digits and email to lowercase. Show duplicate groups. For each group the operator chooses merge, skip, or import as separate. Insert in batches (about 500). Write an import report: created, skipped, merged, invalid. Do not delete the old CRM. Leave it read-only until the report is accepted.

The browser must not parse the full 30,000-row file into React state. The file is read in slices or sent to a job.

## Destructive SQL

No migration in this repository drops business tables automatically. Any later destructive change needs a backup note in the migration comment before it is applied.

# Security checklist

Use this before calling a phase production-ready.

- [ ] Supabase Auth is the only login. Demo passwords are not accepted on the production project.
- [ ] RLS is enabled on every public table. Policies tested with two users in two workspaces.
- [ ] Super Admin cross-org access is a security-definer SQL function, not a value from the client.
- [ ] `VITE_` env contains only the anon key and URL.
- [ ] Service role, Meta secret, and WhatsApp token exist only as Netlify environment variables.
- [ ] Storage buckets are private. Downloads go through signed URLs after an RLS check.
- [ ] Webhooks reject bad signatures and ignore duplicate `external_event_id`.
- [ ] Audit log inserts on login, logout, permission changes, import, export, payment, refund, and file access. Rows are not updated in place.
- [ ] Important entities use `deleted_at` / `deleted_by`. Permanent delete is a separate authorized action.
- [ ] Receptionist policies cannot select consultation or prescription rows.
- [ ] Institute policies cannot select clinic patient rows.
- [ ] Input validated with Zod on the client and with constraints in Postgres.
- [ ] Interrupted call timers do not receive a fabricated duration.
- [ ] Payment insert does not call an external gateway.
- [ ] Errors name the failed rule (file too large, permission denied) and do not fail silently.
- [ ] Free-tier usage is visible. Nothing auto-upgrades the Supabase or Netlify plan.

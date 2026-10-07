# RBAC matrix

Enforcement is three layers: permission keys on the role, checks in server functions, and Postgres RLS. Hiding a menu item is not authorization.

## Roles

| Key | Person |
| --- | --- |
| `super_admin` | BITVION operator. All organizations |
| `admin` | Organization admin. Only grants the Super Admin has left on |
| `receptionist` | Clinic front desk |
| `clinic_bde` | Clinic lead owner |
| `institute_bde` | Institute lead owner |
| `doctor` | Clinical notes for assigned patients |
| `institute_user` | Students, courses, exams |

## Permission keys

`view`, `create`, `read`, `update`, `delete`, `assign`, `export`, `import`, `approve`, `configure`.

## Default grants

Super Admin holds every key. These defaults are seed data. Super Admin can change Admin and the other roles.

| Capability | Admin | Receptionist | Clinic BDE | Institute BDE | Doctor | Institute user |
| --- | --- | --- | --- | --- | --- | --- |
| Leads in own workspace | yes | no | assigned only | assigned only | no | no |
| Assign leads | yes | no | no | no | no | no |
| Import / export leads | yes | no | export own | export own | no | no |
| Appointments | yes | yes | create for own leads | no | own day | no |
| Patient demographics | yes | yes | no | no | assigned patients | no |
| Consultation, prescription, treatment | yes | no | no | no | yes | no |
| Inventory quantity | yes | read | no | no | read and use on treatment | no |
| Record payment | yes | yes | no | no | no | no |
| Revenue reports | yes | no | no | no | no | no |
| Students, courses, marks | yes | no | no | no | no | yes |
| Call-time timer | no | no | own totals | own totals | no | no |
| Call-time targets | configure | no | read own | read own | no | no |
| Integrations and modules | configure | no | no | no | no | no |
| Audit log | read | no | no | no | no | no |

Institute BDE cannot read clinic patient rows. Doctor cannot read revenue. Receptionist cannot read consultation notes.

## Workspace isolation

Every business query includes `organization_id` and `workspace_id`. RLS rejects rows outside the user's memberships. Super Admin is the only role that can cross organizations, and that check is a security-definer function, not a flag sent from the browser.

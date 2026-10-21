import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { accessFor, ROLE_LABEL } from "@/data/catalog";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { formatTalk } from "@/lib/utils";
import { ProductionTeamPage } from "@/pages/production/ProductionTeamDesk";
import type { AccessRights, BusinessUnit, Role, User } from "@/types";

const ACCESS_FIELDS: Array<{ key: keyof AccessRights; label: string }> = [
  { key: "viewAllLeads", label: "See every lead" },
  { key: "assignLeads", label: "Assign fresh leads" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "calls", label: "Phone calls" },
  { key: "campaigns", label: "Campaigns" },
  { key: "reports", label: "Reports" },
  { key: "manageTeam", label: "Manage team" },
  { key: "settings", label: "Settings" },
];

const emptyMember = (): Partial<User> => ({
  name: "",
  email: "",
  phone: "+91",
  role: "counsellor",
  status: "active",
  businessUnit: "clinic",
  branch: "Perumbavoor",
  access: accessFor("counsellor"),
});

export function TeamPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionTeamPage />;
  return <DemoTeamPage />;
}

function DemoTeamPage() {
  const { state, saveUser, removeUser, assignLeads } = useCrm();
  const { previewRole, setPreviewRole } = useAuth();
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  const [error, setError] = useState("");
  const [assignee, setAssignee] = useState("usr_anu");
  const [picked, setPicked] = useState<string[]>([]);
  const isAdmin = previewRole === "administrator";
  const fresh = useMemo(() => state.leads.filter((lead) => lead.status === "new" && !lead.assignedTo), [state.leads]);
  const calls = state.calls ?? [];
  const talkFor = (userId: string) => calls.filter((call) => call.userId === userId).reduce((sum, call) => sum + call.durationSeconds, 0);
  const totalTalk = calls.reduce((sum, call) => sum + call.durationSeconds, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team"
        description="Admin creates employees, sets what each person can open, and assigns fresh Meta leads."
        actions={<Button type="button" disabled={!isAdmin} onClick={() => { setError(""); setEditing(emptyMember()); }}>Add employee</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">Total talk time</p><p className="mt-1 text-2xl font-semibold tabular">{formatTalk(totalTalk)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Fresh unassigned leads</p><p className="mt-1 text-2xl font-semibold tabular">{fresh.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Active employees</p><p className="mt-1 text-2xl font-semibold tabular">{state.users.filter((user) => user.status === "active").length}</p></Card>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["Name", "Desk", "Branch", "Role", "Assigned", "Calls", "Talk time", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {state.users.map((user) => {
              const owned = state.leads.filter((lead) => lead.assignedTo === user.id);
              const callCount = calls.filter((call) => call.userId === user.id).length;
              return (
                <tr key={user.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium">{user.name}</p>
                    <p className="text-xs text-muted">{user.email}</p>
                  </td>
                  <td className="px-3 py-2 capitalize">{user.businessUnit}</td>
                  <td className="px-3 py-2">{user.branch}</td>
                  <td className="px-3 py-2">{ROLE_LABEL[user.role]}</td>
                  <td className="px-3 py-2 tabular">{owned.length}</td>
                  <td className="px-3 py-2 tabular">{callCount}</td>
                  <td className="px-3 py-2 tabular">{formatTalk(talkFor(user.id))}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-xs font-medium" disabled={!isAdmin} onClick={() => { setError(""); setEditing(user); }}>Edit</button>
                    {user.role === "administrator" ? null : (
                      <button type="button" className="ml-3 text-xs font-medium text-danger" disabled={!isAdmin} onClick={() => removeUser(user.id)}>Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Assign fresh leads</h2>
          <p className="mt-1 text-sm text-muted">These arrived from Meta and have no counsellor yet. Clinic leads can use WhatsApp automation after assignment. Institute leads stay on direct calls and WhatsApp.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-64" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            {state.users.filter((user) => user.role !== "viewer" && user.status === "active").map((user) => (
              <option key={user.id} value={user.id}>{user.name} · {user.businessUnit} · {user.branch}</option>
            ))}
          </Select>
          <Button type="button" disabled={!isAdmin || picked.length === 0} onClick={() => { assignLeads(picked, assignee); setPicked([]); }}>Assign selected</Button>
          <Button type="button" variant="secondary" disabled={!isAdmin || fresh.length === 0} onClick={() => { assignLeads(fresh.slice(0, 10).map((lead) => lead.id), assignee); }}>Assign next 10</Button>
        </div>
        <div className="max-h-72 overflow-auto rounded-md border border-line">
          {fresh.slice(0, 20).map((lead) => (
            <div key={lead.id} className="flex items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-0">
              <input type="checkbox" aria-label={`Select ${lead.fullName}`} checked={picked.includes(lead.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, lead.id] : picked.filter((id) => id !== lead.id))} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{lead.fullName}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted"><PhoneLink phone={lead.phone} /> · {lead.location} · {lead.position} · {lead.businessUnit === "clinic" ? "Clinic" : "Institute"}</span>
              </span>
            </div>
          ))}
          {fresh.length === 0 ? <p className="px-3 py-6 text-sm text-muted">The fresh queue is clear.</p> : null}
        </div>
      </Card>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm">Preview interface as</span>
        <Select className="w-56" value={previewRole} onChange={(event) => setPreviewRole(event.target.value as Role)}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
        </Select>
        <span className="text-xs text-muted">Sign in as a counsellor to open their own lead desk. Passwords are on the login screen.</span>
      </Card>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit employee" : "Add employee"}</DialogTitle></DialogHeader>
          {editing ? (
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              const message = saveUser({
                id: editing.id,
                name: editing.name ?? "",
                email: editing.email ?? "",
                phone: editing.phone ?? "",
                role: editing.role ?? "counsellor",
                status: editing.status ?? "active",
                businessUnit: editing.businessUnit ?? "clinic",
                branch: editing.branch ?? "",
                access: editing.access ?? accessFor(editing.role ?? "counsellor"),
              });
              if (message) setError(message);
              else setEditing(null);
            }}>
              <Input placeholder="Name" value={editing.name ?? ""} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
              <Input placeholder="Email" value={editing.email ?? ""} onChange={(event) => setEditing({ ...editing, email: event.target.value })} />
              <Input placeholder="Phone" value={editing.phone ?? ""} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} />
              <Input placeholder="Branch" value={editing.branch ?? ""} onChange={(event) => setEditing({ ...editing, branch: event.target.value })} />
              <Select value={editing.businessUnit} onChange={(event) => setEditing({ ...editing, businessUnit: event.target.value as BusinessUnit | "both" })}>
                <option value="clinic">Clinic · Dr. K's Aesthetic Clinic</option>
                <option value="institute">Institute · IAA Kochi</option>
                <option value="both">Both desks</option>
              </Select>
              <Select value={editing.role} onChange={(event) => {
                const role = event.target.value as Role;
                setEditing({ ...editing, role, access: accessFor(role) });
              }}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </Select>
              <Select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as User["status"] })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
              <div className="grid gap-2 sm:grid-cols-2">
                {ACCESS_FIELDS.map((field) => (
                  <label key={field.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(editing.access?.[field.key])}
                      onChange={(event) => setEditing({ ...editing, access: { ...(editing.access ?? accessFor("counsellor")), [field.key]: event.target.checked } })}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <div className="flex justify-end"><Button type="submit">Save</Button></div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

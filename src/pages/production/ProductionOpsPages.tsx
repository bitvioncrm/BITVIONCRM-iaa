import { useEffect, useState } from "react";
import { MetaLeadCentre } from "@/pages/production/MetaLeadCentre";
import { listLeads, listWorkspaces, updateLeadStatus, type ProductionLead, type WorkspaceOption } from "@/services/production-leads";
import { bookFromLead, createTask, listAudit, listTasks, removeTask, revenueSummary, updateTask } from "@/services/production-ops";
import { useAuth } from "@/context/AuthContext";
import { STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import type { LeadStatus } from "@/types";

function WorkspaceSelect({ value, onChange, rows }: { value: string; onChange: (value: string) => void; rows: WorkspaceOption[] }) {
  return (
    <select className="h-11 w-full max-w-full rounded-md border border-line px-2 text-base sm:h-9 sm:w-auto sm:text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
      {rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  );
}

export function ProductionPipeline() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [rows, setRows] = useState<ProductionLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<ProductionLead | null>(null);
  const [draft, setDraft] = useState({ fullName: "", phone: "", email: "", place: "", interest: "", gender: "other", dateOfBirth: "", address: "", bookedOn: "", appointmentAt: "", fee: "", paid: "", method: "cash" as "cash" | "upi" | "card" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listWorkspaces().then((items) => {
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id ?? "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setLoading(true);
    void listLeads({ page: 1, workspaceId, counted: false })
      .then((result) => {
        if (active) setRows(result.leads);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load leads");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    const refresh = () => {
      void listLeads({ page: 1, workspaceId, counted: false })
        .then((result) => setRows(result.leads))
        .catch(() => undefined);
    };
    window.addEventListener("bitvion-lead", refresh);
    window.addEventListener("bitvion-lead-update", refresh);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 10000);
    return () => {
      window.removeEventListener("bitvion-lead", refresh);
      window.removeEventListener("bitvion-lead-update", refresh);
      window.clearInterval(timer);
    };
  }, [workspaceId]);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Pipeline</h1>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <WorkspaceSelect value={workspaceId} onChange={setWorkspaceId} rows={workspaces} />
      {loading ? <p className="text-sm text-muted">Loading leads.</p> : null}
      {!loading && rows.length === 0 ? <p className="text-sm text-muted">No leads on this page.</p> : null}
      {rows.map((lead) => (
        <div key={lead.id} className="space-y-3 rounded-lg border border-line bg-white px-3 py-3 text-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 break-words">{lead.fullName}</span>
          <select className="h-11 w-full rounded-md border border-line px-2 text-base sm:h-9 sm:w-48 sm:text-sm" value={booking?.id === lead.id ? "selected" : lead.status} onChange={(event) => {
            const status = event.target.value as LeadStatus;
            if (status === "selected") {
              setBooking(lead);
              setDraft({ fullName: lead.fullName, phone: lead.phone, email: lead.email, place: lead.location, interest: lead.position, gender: "other", dateOfBirth: "", address: "", bookedOn: new Date().toISOString().slice(0, 10), appointmentAt: "", fee: "", paid: "", method: "cash" });
              return;
            }
            void updateLeadStatus(lead, status)
              .then(() => setRows((current) => current.map((item) => item.id === lead.id ? { ...item, status } : item)))
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Stage update failed"));
          }}>
            {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
          </select>
          </div>
          {booking?.id === lead.id ? (
            <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => {
              event.preventDefault();
              const institute = workspaces.find((item) => item.id === lead.workspaceId)?.workspaceType === "institute";
              setBusy(true);
              void bookFromLead({
                leadId: lead.id,
                organizationId: lead.organizationId,
                workspaceId: lead.workspaceId,
                fromStatus: lead.status,
                institute,
                fullName: draft.fullName,
                phone: draft.phone,
                email: draft.email,
                place: draft.place,
                interest: draft.interest,
                gender: draft.gender,
                dateOfBirth: draft.dateOfBirth || null,
                address: draft.address,
                bookedOn: draft.bookedOn,
                appointmentAt: draft.appointmentAt,
                fee: Number(draft.fee || 0),
                paid: Number(draft.paid || 0),
                method: draft.method,
              }).then(() => {
                setRows((current) => current.map((item) => item.id === lead.id ? { ...item, status: "selected", fullName: draft.fullName.trim() } : item));
                setBooking(null);
              }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not book")).finally(() => setBusy(false));
            }}>
              <label className="text-sm sm:col-span-2">Name<input required value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Phone<input value={draft.phone} inputMode="tel" onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Email<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Place<input value={draft.place} onChange={(event) => setDraft({ ...draft, place: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">{workspaces.find((item) => item.id === lead.workspaceId)?.workspaceType === "institute" ? "Course" : "Treatment"}<input value={draft.interest} onChange={(event) => setDraft({ ...draft, interest: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Gender<select value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3"><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
              <label className="text-sm">Date of birth<input type="date" value={draft.dateOfBirth} onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm sm:col-span-2">Address<textarea value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
              <label className="text-sm">Booked date<input required type="date" value={draft.bookedOn} onChange={(event) => setDraft({ ...draft, bookedOn: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Appointment date<input required type="datetime-local" value={draft.appointmentAt} onChange={(event) => setDraft({ ...draft, appointmentAt: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Fee<input inputMode="decimal" value={draft.fee} onChange={(event) => setDraft({ ...draft, fee: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Paid now<input inputMode="decimal" value={draft.paid} onChange={(event) => setDraft({ ...draft, paid: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <p className="text-sm font-semibold sm:col-span-2">Balance ₹{Math.max(0, Number(draft.fee || 0) - Number(draft.paid || 0)).toLocaleString("en-IN")}</p>
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white">{busy ? "Saving" : "Save booking"}</button>
                <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => setBooking(null)}>Cancel</button>
              </div>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ProductionTasks() {
  const { productionUser } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [rows, setRows] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const load = (id: string) => void listTasks(id).then((items) => setRows(items as typeof rows)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load tasks"));
  useEffect(() => {
    void listWorkspaces().then((items) => {
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id ?? "");
      if (items[0]) load(items[0].id);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Tasks</h1>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <WorkspaceSelect value={workspaceId} onChange={(value) => { setWorkspaceId(value); load(value); }} rows={workspaces} />
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
        event.preventDefault();
        if (!workspace || !productionUser) return;
        void createTask({ organizationId: workspace.organizationId, workspaceId: workspace.id, title, dueAt: new Date().toISOString(), assignedTo: productionUser.userId })
          .then(() => { setTitle(""); load(workspace.id); })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the task"));
      }}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Task" className="h-11 flex-1 rounded-md border border-line px-2 text-base sm:h-9 sm:text-sm" />
        <button className="h-11 rounded-md bg-navy px-3 text-sm text-white sm:h-9" type="submit">Add</button>
      </form>
      {rows.length === 0 ? <p className="text-sm text-muted">No tasks.</p> : rows.map((task) => (
        <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{task.title} · {task.status}</span>
          <span className="flex gap-2">
            <button type="button" className="text-xs font-medium" onClick={() => { void updateTask(task.id, { status: task.status === "completed" ? "pending" : "completed" }).then(() => load(workspaceId)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not update the task")); }}>{task.status === "completed" ? "Reopen" : "Complete"}</button>
            <button type="button" className="text-xs font-medium text-danger" onClick={() => { if (!window.confirm(`Delete ${task.title}?`)) return; void removeTask(task.id).then(() => load(workspaceId)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not delete the task")); }}>Delete</button>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProductionReports() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<{ gross: number; discounts: number; collected: number; refunded: number; net: number; pending: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void listWorkspaces().then((items) => {
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id ?? "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Reports</h1>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <WorkspaceSelect value={workspaceId} onChange={setWorkspaceId} rows={workspaces} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-11 rounded-md border border-line px-2 text-base sm:h-9 sm:text-sm" />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-11 rounded-md border border-line px-2 text-base sm:h-9 sm:text-sm" />
        <button type="button" className="h-11 rounded-md bg-navy px-3 text-sm text-white sm:h-9" onClick={() => {
          if (!workspaceId) return;
          void revenueSummary(workspaceId, from, to).then(setSummary).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Revenue requires the latest migration"));
        }}>Load</button>
      </div>
      {summary ? <p className="text-sm">Gross {summary.gross} · Discounts {summary.discounts} · Collected {summary.collected} · Refunds {summary.refunded} · Net {summary.net} · Pending {summary.pending}</p> : null}
    </div>
  );
}

export function ProductionActivity() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [rows, setRows] = useState<Array<{ id: string; action: string; entity: string; created_at: string }>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void listWorkspaces().then((items) => {
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id ?? "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);
  useEffect(() => {
    if (!workspaceId) return;
    void listAudit(workspaceId).then((items) => setRows(items as typeof rows)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the audit log"));
  }, [workspaceId]);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Audit</h1>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <WorkspaceSelect value={workspaceId} onChange={setWorkspaceId} rows={workspaces} />
      {rows.length === 0 ? <p className="text-sm text-muted">No audit rows for this workspace.</p> : rows.map((row) => <p key={row.id} className="text-sm">{row.created_at} · {row.action} · {row.entity}</p>)}
    </div>
  );
}

export function ProductionSettings() {
  return <MetaLeadCentre />;
}

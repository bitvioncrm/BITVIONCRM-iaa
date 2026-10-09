import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listLeads, listWorkspaces, updateLeadStatus, type ProductionLead, type WorkspaceOption } from "@/services/production-leads";
import { createTask, listAudit, listTasks, revenueSummary } from "@/services/production-ops";
import { useAuth } from "@/context/AuthContext";
import { STATUS_ORDER } from "@/data/catalog";
import type { LeadStatus } from "@/types";

function WorkspaceSelect({ value, onChange, rows }: { value: string; onChange: (value: string) => void; rows: WorkspaceOption[] }) {
  return (
    <select className="rounded-md border border-line px-2 py-2" value={value} onChange={(event) => onChange(event.target.value)}>
      {rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  );
}

export function ProductionPipeline() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [rows, setRows] = useState<ProductionLead[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void listWorkspaces().then((items) => {
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id ?? "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);
  useEffect(() => {
    if (!workspaceId) return;
    void listLeads({ page: 1, workspaceId }).then((result) => setRows(result.leads)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load leads"));
  }, [workspaceId]);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Pipeline</h1>
      <p className="text-sm text-muted">Stage changes are written to PostgreSQL. This page loads one page of leads, not the full book.</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <WorkspaceSelect value={workspaceId} onChange={setWorkspaceId} rows={workspaces} />
      {rows.length === 0 ? <p className="text-sm text-muted">No leads on this page.</p> : null}
      {rows.map((lead) => (
        <div key={lead.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <span>{lead.fullName}</span>
          <select value={lead.status} onChange={(event) => {
            const status = event.target.value as LeadStatus;
            void updateLeadStatus(lead, status)
              .then(() => setRows((current) => current.map((item) => item.id === lead.id ? { ...item, status } : item)))
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Stage update failed"));
          }}>
            {STATUS_ORDER.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
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
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (!workspace || !productionUser) return;
        void createTask({ organizationId: workspace.organizationId, workspaceId: workspace.id, title, dueAt: new Date().toISOString(), assignedTo: productionUser.userId })
          .then(() => { setTitle(""); load(workspace.id); })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the task"));
      }}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Task" className="flex-1 rounded-md border border-line px-2 py-2" />
        <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Add</button>
      </form>
      {rows.length === 0 ? <p className="text-sm text-muted">No tasks.</p> : rows.map((task) => <p key={task.id} className="text-sm">{task.title} · {task.status}</p>)}
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
      <p className="text-sm text-muted">Revenue comes from invoices, payments, and refunds. Leads are not counted as revenue.</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <WorkspaceSelect value={workspaceId} onChange={setWorkspaceId} rows={workspaces} />
      <div className="flex gap-2">
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-md border border-line px-2 py-2" />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-md border border-line px-2 py-2" />
        <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => {
          if (!workspaceId) return;
          void revenueSummary(workspaceId, from, to).then(setSummary).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Revenue requires the latest migration"));
        }}>Load</button>
      </div>
      {summary ? <p className="text-sm">Gross {summary.gross} · Discounts {summary.discounts} · Collected {summary.collected} · Refunds {summary.refunded} · Net {summary.net} · Pending {summary.pending}</p> : <p className="text-sm text-muted">Choose a range and load. This fails until revenue_totals is applied.</p>}
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
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-muted">Meta and WhatsApp stay unconnected until server secrets are set. This screen cannot mark them connected.</p>
      <p className="text-sm"><Link className="font-medium text-accent" to="/meta">Open Meta Lead Centre</Link></p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDesk } from "@/context/DeskContext";
import { ProductionImportDialog } from "@/components/leads/ProductionImportDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { downloadText } from "@/lib/csv";
import {
  addFollowUp,
  addLeadNote,
  assignLead,
  createLead,
  downloadWorkspaceCsv,
  listAssignableMembers,
  listLeads,
  listWorkspaces,
  updateLeadStatus,
  type MemberOption,
  type ProductionLead,
  type WorkspaceOption,
} from "@/services/production-leads";
import { useAuth } from "@/context/AuthContext";
import type { LeadStatus } from "@/types";

export function ProductionLeadsPage() {
  const { productionUser } = useAuth();
  const { desk, setDesk, bounds } = useDesk();
  const [params] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [source, setSource] = useState(params.get("source") ?? "");
  const [unassigned, setUnassigned] = useState(params.get("assigned") === "unassigned");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [leads, setLeads] = useState<ProductionLead[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState({ fullName: "", phone: "", email: "", location: "", position: "" });

  useEffect(() => {
    const requested = params.get("desk");
    if (requested === "all" || requested === "clinic" || requested === "institute") setDesk(requested);
  }, [params, setDesk]);

  useEffect(() => {
    void listWorkspaces()
      .then((rows) => setWorkspaces(rows))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);

  useEffect(() => {
    const visible = desk === "all" ? workspaces : workspaces.filter((item) => item.workspaceType === desk);
    setWorkspaceId((current) => visible.some((item) => item.id === current) ? current : desk === "all" ? "" : visible[0]?.id ?? "");
  }, [desk, workspaces]);

  useEffect(() => {
    if (!workspaceId) return;
    void listAssignableMembers(workspaceId).then(setMembers).catch(() => setMembers([]));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaces.length) return;
    if (desk !== "all" && !workspaceId) return;
    setLoading(true);
    void listLeads({ page, workspaceId: workspaceId || undefined, status, search, source, unassigned, createdFrom: bounds.from, createdTo: bounds.to })
      .then((result) => {
        setLeads(result.leads);
        setPages(result.pages);
        setTotal(result.total);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load leads"))
      .finally(() => setLoading(false));
  }, [bounds.from, bounds.to, desk, page, reload, search, source, status, unassigned, workspaceId, workspaces.length]);

  const workspace = workspaces.find((item) => item.id === workspaceId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description={loading ? "Loading this page from PostgreSQL." : `${total.toLocaleString("en-IN")} leads created in ${bounds.label}. The list is one page at a time.`}
        actions={
          <>
            <Button type="button" variant="secondary" disabled={!workspace} onClick={() => setImportOpen(true)}>Import</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!workspaceId}
              onClick={() => {
                void downloadWorkspaceCsv(workspaceId, { from: bounds.from, to: bounds.to }).then((csv) => downloadText("bitvion-leads.csv", `\uFEFF${csv}`)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Export failed"));
              }}
            >
              Export
            </Button>
          </>
        }
      />
      {source || unassigned ? (
        <p className="text-sm text-muted">
          Filters: {source || "any source"}{unassigned ? " · unassigned" : ""}{" "}
          <button type="button" className="font-medium text-accent" onClick={() => { setSource(""); setUnassigned(false); setPage(1); }}>Clear</button>
        </p>
      ) : null}
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      <div className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-4">
        <Select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setPage(1); }}>
          {desk === "all" ? <option value="">All authorized desks</option> : null}
          {(desk === "all" ? workspaces : workspaces.filter((item) => item.workspaceType === desk)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Input placeholder="Search name, phone, email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Stage</option>
          {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
        </Select>
      </div>
      {workspace ? (
        <form
          className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            void createLead({
              organizationId: workspace.organizationId,
              workspaceId: workspace.id,
              fullName: draft.fullName,
              phone: draft.phone,
              email: draft.email,
              location: draft.location,
              position: draft.position,
              source: "other",
              priority: "medium",
              status: "new",
              assignedTo: productionUser?.userId ?? null,
            })
              .then(() => {
                setDraft({ fullName: "", phone: "", email: "", location: "", position: "" });
                setPage(1);
                return listLeads({ page: 1, workspaceId, status, search, source, unassigned, createdFrom: bounds.from, createdTo: bounds.to });
              })
              .then((result) => {
                setLeads(result.leads);
                setTotal(result.total);
                setPages(result.pages);
              })
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not create the lead"));
          }}
        >
          <Input required placeholder="Name" value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
          <Input required placeholder="Phone" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
          <Input placeholder="Email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          <Input placeholder="Place" value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} />
          <Input placeholder="Interest" value={draft.position} onChange={(event) => setDraft({ ...draft, position: event.target.value })} />
          <Button type="submit">Add lead</Button>
        </form>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["Name", "Phone", "Stage", "Assign", "Follow-up"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium"><Link to={`/leads/${lead.id}`}>{lead.fullName}</Link></td>
                <td className="px-3 py-2"><PhoneLink phone={lead.phone} /></td>
                <td className="px-3 py-2">
                  <Select
                    value={lead.status}
                    onChange={(event) => {
                      const next = event.target.value as LeadStatus;
                      void updateLeadStatus(lead, next)
                        .then(() => setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, status: next } : item))))
                        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not update the stage"));
                    }}
                  >
                    {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
                  </Select>
                  <StatusBadge status={lead.status} />
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={lead.assignedTo ?? ""}
                    onChange={(event) => {
                      const assignedTo = event.target.value;
                      if (!assignedTo) return;
                      void assignLead(lead, assignedTo)
                        .then(() => setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, assignedTo } : item))))
                        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign the lead"));
                    }}
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => <option key={member.userId} value={member.userId}>{member.name} · {member.role === "clinic_bde" ? "Clinic BDE" : "Institute BDE"}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const note = window.prompt("Note");
                      if (!note?.trim()) return;
                      void addLeadNote(lead, note).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the note"));
                    }}
                  >
                    Note
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const due = window.prompt("Follow-up time (YYYY-MM-DDTHH:mm)");
                      if (!due) return;
                      void addFollowUp(lead, new Date(due).toISOString(), "Follow-up").catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the follow-up"));
                    }}
                  >
                    Follow-up
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && !loading ? <p className="px-4 py-8 text-sm text-muted">No leads on this page.</p> : null}
        <Pagination page={page} pages={pages} onPage={setPage} />
      </div>
      {workspace ? <ProductionImportDialog open={importOpen} workspace={workspace} members={members} onOpenChange={setImportOpen} onImported={() => setReload((value) => value + 1)} /> : null}
    </div>
  );
}

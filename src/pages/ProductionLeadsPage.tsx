import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDesk } from "@/context/DeskContext";
import { ProductionImportDialog } from "@/components/leads/ProductionImportDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { WhatsAppLink } from "@/components/shared/WhatsAppLink";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { isExcelLead, leadOriginLabel, LEAD_ORIGINS, type LeadOrigin } from "@/lib/lead-origin";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/range";
import { downloadText } from "@/lib/csv";
import {
  addFollowUp,
  addLeadNote,
  assignLead,
  assignLeadCount,
  assignUnassignedLeads,
  clearAssignedLeads,
  clearLeadAssignment,
  createLead,
  downloadWorkspaceCsv,
  leadAssignmentTotals,
  leadSourceTotals,
  type AssignmentTotals,
  type LeadSourceTotals,
  listAssignableMembers,
  listLeads,
  listRecentLeadDays,
  loadLeadList,
  PAGE_SIZE,
  listWorkspaces,
  updateLeadStatus,
  type LeadDayCount,
  type MemberOption,
  type ProductionLead,
  type WorkspaceOption,
} from "@/services/production-leads";
import { CallResultButtons } from "@/components/calls/CallResultButtons";
import { useAuth } from "@/context/AuthContext";
import { useDialEndedAt } from "@/components/calls/useDialEndedAt";
import { formatClock, outcomeFromPhoneReturn, type CallOutcome, type CallTotals } from "@/lib/call-time";
import { formatLeadArrived } from "@/lib/dates";
import { phoneTel } from "@/lib/phone";
import { canOperateWhatsApp, canWriteWhatsApp, productionRoleLabel, whatsAppDesk } from "@/lib/production-access";
import { activeCall, endCall, leadCallStats, startCall, type LiveCall } from "@/services/production-ops";
import type { LeadStatus } from "@/types";

export function ProductionLeadsPage() {
  const { productionUser } = useAuth();
  const callerDesk = whatsAppDesk(productionUser?.roleKey ?? "");
  const canAssign = canOperateWhatsApp(productionUser?.roleKey ?? "");
  const canWhatsApp = canWriteWhatsApp(productionUser?.roleKey ?? "");
  const { desk, setDesk, bounds, rangeKey, setRangeKey, customFrom, setCustomFrom, customTo, setCustomTo } = useDesk();
  const [params] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [source, setSource] = useState(params.get("source") ?? "");
  const [origin, setOrigin] = useState<LeadOrigin>("all");
  const [unassigned, setUnassigned] = useState(params.get("assigned") === "unassigned");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [leads, setLeads] = useState<ProductionLead[]>([]);
  const [days, setDays] = useState<LeadDayCount[]>([]);
  const [sources, setSources] = useState<LeadSourceTotals>({ all: 0, meta: 0, excel: 0, whatsapp: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState({ fullName: "", phone: "", email: "", location: "", position: "" });
  const [assignCounts, setAssignCounts] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState("");
  const [totals, setTotals] = useState<AssignmentTotals>({ unassigned: 0, desks: {}, assigned: {} });
  const [notice, setNotice] = useState("");
  const [sheet, setSheet] = useState<{ lead: ProductionLead; kind: "note" | "follow" } | null>(null);
  const [sheetValue, setSheetValue] = useState("");
  const [callStats, setCallStats] = useState<Record<string, CallTotals>>({});
  const [live, setLive] = useState<LiveCall | null>(null);
  const [now, setNow] = useState(0);
  const [callBusy, setCallBusy] = useState(false);
  const quietRefresh = useRef(false);
  const viewRef = useRef({ workspaceId: "", desk, status: "", source: "", origin, unassigned: false, search: "", workspaces: [] as WorkspaceOption[] });
  viewRef.current = { workspaceId, desk, status, source, origin, unassigned, search: searchQuery, workspaces };

  useEffect(() => {
    setRangeKey("all");
  }, [setRangeKey]);

  useEffect(() => {
    if (callerDesk === "clinic" || callerDesk === "institute") {
      setDesk(callerDesk);
      return;
    }
    const requested = params.get("desk");
    if (requested === "all" || requested === "clinic" || requested === "institute") setDesk(requested);
  }, [callerDesk, params, setDesk]);

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
    if (!workspaces.length) return;
    void listRecentLeadDays(workspaces).then(setDays).catch(() => setDays([]));
    void leadSourceTotals().then(setSources).catch(() => setSources({ all: 0, meta: 0, excel: 0, whatsapp: 0 }));
  }, [reload, workspaces]);

  useEffect(() => {
    if (!workspaces.length) {
      setMembers([]);
      return;
    }
    void Promise.all(workspaces.map((item) => listAssignableMembers(item.id, item.workspaceType)))
      .then((groups) => setMembers(groups.flat()))
      .catch(() => setMembers([]));
  }, [workspaces]);

  useEffect(() => {
    if (quietRefresh.current) return;
    void leadAssignmentTotals()
      .then(setTotals)
      .catch(() => setTotals({ unassigned: 0, desks: {}, assigned: {} }));
  }, [reload]);

  useEffect(() => {
    if (!workspaces.length) return;
    if (desk !== "all" && !workspaceId) return;
    const silent = quietRefresh.current;
    quietRefresh.current = false;
    if (!silent) setLoading(true);
    let active = true;
    const pending = loadLeadList({ page, workspaceId: workspaceId || undefined, status, search: searchQuery, source, origin, unassigned, createdFrom: bounds.from, createdTo: bounds.to });
    void Promise.resolve(pending.leads)
      .then((leads) => {
        if (!active) return;
        setLeads(leads);
        setError("");
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Could not load leads");
        setLoading(false);
      });
    void Promise.resolve(pending.total)
      .then((total) => {
        if (!active) return;
        setTotal(total);
        setPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bounds.from, bounds.to, desk, origin, page, reload, searchQuery, source, status, unassigned, workspaceId, workspaces.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const refresh = () => {
      quietRefresh.current = true;
      setReload((value) => value + 1);
    };
    const onLead = (event: Event) => {
      const detail = (event as CustomEvent<{ fullName?: string; row?: Record<string, string | null> }>).detail;
      const row = detail?.row;
      if (row?.id) {
        const lead: ProductionLead = {
          id: String(row.id),
          organizationId: String(row.organization_id ?? ""),
          workspaceId: String(row.workspace_id ?? ""),
          fullName: String(row.full_name || detail.fullName || "New lead"),
          phone: String(row.phone ?? ""),
          email: String(row.email ?? ""),
          location: String(row.location ?? ""),
          position: String(row.position ?? ""),
          source: String(row.source ?? ""),
          sourcePlatform: String(row.source_platform ?? ""),
          priority: String(row.priority ?? "medium"),
          status: (row.status as LeadStatus) || "new",
          assignedTo: row.assigned_to ? String(row.assigned_to) : null,
          createdAt: String(row.created_at ?? new Date().toISOString()),
          nextFollowUpAt: row.next_follow_up_at ? String(row.next_follow_up_at) : null,
        };
        const view = viewRef.current;
        const deskIds = view.desk === "all" ? view.workspaces.map((item) => item.id) : view.workspaces.filter((item) => item.workspaceType === view.desk).map((item) => item.id);
        const excel = lead.status === "excel" || isExcelLead(lead.source, lead.sourcePlatform);
        const visible = (!view.workspaceId || lead.workspaceId === view.workspaceId)
          && (!deskIds.length || deskIds.includes(lead.workspaceId))
          && (!view.status || lead.status === view.status)
          && (!view.source || lead.source === view.source)
          && (view.origin !== "excel" || excel)
          && (view.origin !== "live" || !excel)
          && (!view.unassigned || !lead.assignedTo)
          && (!view.search.trim() || `${lead.fullName} ${lead.phone}`.toLowerCase().includes(view.search.trim().toLowerCase()));
        if (visible) {
          setPage(1);
          setLeads((current) => current.some((item) => item.id === lead.id) ? current : [lead, ...current].slice(0, 20));
          setTotal((current) => current + 1);
        }
      }
      setNotice(detail?.fullName ? `New lead: ${detail.fullName}` : "A new lead arrived.");
      refresh();
    };
    const onUpdate = (event: Event) => {
      const row = (event as CustomEvent<{ row?: Record<string, string | null> }>).detail?.row;
      if (!row?.id) return;
      setLeads((current) => current.map((item) => item.id === row.id ? {
        ...item,
        status: (row.status as LeadStatus) || item.status,
        assignedTo: row.assigned_to ? String(row.assigned_to) : null,
        fullName: String(row.full_name || item.fullName),
      } : item));
      refresh();
    };
    window.addEventListener("bitvion-lead", onLead);
    window.addEventListener("bitvion-lead-update", onUpdate);
    const timer = window.setInterval(() => {
      const focused = document.activeElement;
      if (document.visibilityState !== "visible") return;
      if (focused instanceof HTMLSelectElement || focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
      refresh();
    }, 5000);
    return () => {
      window.removeEventListener("bitvion-lead", onLead);
      window.removeEventListener("bitvion-lead-update", onUpdate);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void activeCall().then(setLive).catch(() => setLive(null));
  }, []);

  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  useEffect(() => {
    const ids = leads.map((lead) => lead.id);
    if (!ids.length) {
      setCallStats({});
      return;
    }
    void leadCallStats(ids).then(setCallStats).catch(() => setCallStats({}));
  }, [leads]);

  const deskWorkspaces = callerDesk === "clinic" || callerDesk === "institute"
    ? workspaces.filter((item) => item.workspaceType === callerDesk)
    : desk === "all"
      ? workspaces
      : workspaces.filter((item) => item.workspaceType === desk);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const returnedAt = useDialEndedAt(Boolean(live));
  const elapsed = live ? Math.max(0, Math.floor(((returnedAt ? new Date(returnedAt).getTime() : now) - new Date(live.startedAt).getTime()) / 1000)) : 0;
  const liveLead = leads.find((lead) => lead.id === live?.leadId);
  const savedDial = useRef("");

  function beginCall(lead: ProductionLead) {
    if (!phoneTel(lead.phone)) {
      setError("This lead has no phone number to dial.");
      return;
    }
    setCallBusy(true);
    void startCall(lead.organizationId, lead.workspaceId, lead.id)
      .then((row) => {
        setLive(row);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Start call failed"))
      .finally(() => setCallBusy(false));
  }

  function finishCall(outcome: CallOutcome, endedAt?: string) {
    if (!live || savedDial.current === live.id) return;
    savedDial.current = live.id;
    setCallBusy(true);
    const sessionId = live.id;
    void endCall(sessionId, outcome, endedAt)
      .then(async () => {
        setLive(null);
        const ids = leads.map((lead) => lead.id);
        if (ids.length) setCallStats(await leadCallStats(ids));
        setNotice(outcome === "connected" ? "Connected call saved on this lead." : "Dial saved. Talk time was not added.");
      })
      .catch((reason: unknown) => {
        savedDial.current = "";
        setError(reason instanceof Error ? reason.message : "End call failed");
      })
      .finally(() => setCallBusy(false));
  }

  useEffect(() => {
    if (!live || !returnedAt) return;
    const seconds = Math.max(0, Math.floor((new Date(returnedAt).getTime() - new Date(live.startedAt).getTime()) / 1000));
    finishCall(outcomeFromPhoneReturn(seconds), returnedAt);
  }, [live, returnedAt]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description={loading ? "Loading leads." : `${total.toLocaleString("en-IN")} ${LEAD_ORIGINS.find((item) => item.value === origin)?.label.toLowerCase() ?? "leads"} · ${desk === "clinic" ? "Clinic" : desk === "institute" ? "Institute" : "All desks"} · ${bounds.label}.`}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setReload((value) => value + 1)}>Refresh</Button>
            <Button type="button" disabled={!workspaces.length} onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import CSV
            </Button>
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
      <p className="text-sm text-muted">{sources.all.toLocaleString("en-IN")} leads in the CRM · {sources.meta.toLocaleString("en-IN")} Meta forms · {sources.excel.toLocaleString("en-IN")} Excel · {sources.whatsapp.toLocaleString("en-IN")} WhatsApp clicks.</p>
      {days.length ? (
        <div className="grid gap-2 sm:grid-cols-5">
          {days.map((day) => (
            <button key={day.key} type="button" className="rounded-lg border border-line bg-white px-3 py-2 text-left" onClick={() => { setRangeKey("custom"); setCustomFrom(day.key); setCustomTo(day.key); setOrigin("live"); setPage(1); }}>
              <p className="text-xs text-muted">{day.label}</p>
              <p className="text-2xl font-semibold">{day.total}</p>
              <p className="text-xs text-muted">Clinic {day.clinic}</p>
              <p className="text-xs text-muted">Institute {day.institute}</p>
              <p className="text-xs text-muted">WhatsApp {day.whatsapp}</p>
            </button>
          ))}
        </div>
      ) : null}
      {notice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}
      {sheet ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-white p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = sheetValue.trim();
            if (!value) return;
            if (sheet.kind === "follow" && Number.isNaN(new Date(value).getTime())) {
              setError("Choose a follow-up time.");
              return;
            }
            const action = sheet.kind === "note"
              ? addLeadNote(sheet.lead, value)
              : addFollowUp(sheet.lead, new Date(value).toISOString(), "Follow-up");
            void action
              .then(() => {
                setNotice(sheet.kind === "note" ? `Note saved for ${sheet.lead.fullName}.` : `Follow-up saved for ${sheet.lead.fullName}.`);
                setSheet(null);
                setSheetValue("");
              })
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save"));
          }}
        >
          <label className="min-w-64 flex-1 text-sm">
            {sheet.kind === "note" ? `Note for ${sheet.lead.fullName}` : `Follow-up for ${sheet.lead.fullName}`}
            {sheet.kind === "note" ? (
              <textarea value={sheetValue} onChange={(event) => setSheetValue(event.target.value)} rows={2} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none" placeholder="Write the note" />
            ) : (
              <Input className="mt-1" type="datetime-local" value={sheetValue} onChange={(event) => setSheetValue(event.target.value)} />
            )}
          </label>
          <Button type="submit">Save</Button>
          <Button type="button" variant="secondary" onClick={() => setSheet(null)}>Cancel</Button>
        </form>
      ) : null}
      <div className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-3 xl:grid-cols-6">
        <Select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setPage(1); }} aria-label="Desk">
          {canAssign && desk === "all" ? <option value="">All authorized desks</option> : null}
          {deskWorkspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select value={origin} onChange={(event) => { setOrigin(event.target.value as LeadOrigin); setPage(1); }} aria-label="Lead source">
          {LEAD_ORIGINS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
        <Select value={rangeKey} onChange={(event) => { setRangeKey(event.target.value as RangeKey); setPage(1); }} aria-label="Date range">
          {RANGE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </Select>
        {rangeKey === "custom" ? (
          <>
            <Input aria-label="From" type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} />
            <Input aria-label="To" type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} />
          </>
        ) : null}
        <Input placeholder="Search name, phone, email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Stage">
          <option value="">Stage</option>
          {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
        </Select>
      </div>
      {canAssign ? (
        <section className="grid gap-3 lg:grid-cols-2">
          {deskWorkspaces.map((item) => {
            const people = members.filter((member) => member.workspaceId === item.id).sort((left, right) => left.name.localeCompare(right.name));
            const waiting = Number(totals.desks[item.id] ?? 0);
            const deskLabel = item.workspaceType === "institute" ? "Institute" : "Clinic";
            return (
              <div key={item.id} className="space-y-3 rounded-lg border border-line bg-white p-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{deskLabel}</p>
                  <h2 className="text-sm font-semibold">{item.name}</h2>
                  <p className="mt-1 text-sm text-muted">{waiting.toLocaleString("en-IN")} waiting</p>
                </div>
                {people.length === 0 ? <p className="text-sm text-muted">Add a {deskLabel.toLowerCase()} telecaller before these leads can be assigned.</p> : people.map((member) => {
                  const held = Number(totals.assigned[member.userId] ?? 0);
                  const finish = (count: number) => {
                    setError("");
                    setNotice(`Assigned ${count.toLocaleString("en-IN")} leads to ${member.name} on ${item.name}.`);
                    setAssignCounts((current) => ({ ...current, [member.userId]: "" }));
                    setPage(1);
                    setReload((value) => value + 1);
                  };
                  return (
                    <form
                      key={member.userId}
                      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const limit = Number(assignCounts[member.userId] ?? "");
                        if (!Number.isInteger(limit) || limit < 1) {
                          setError("Enter how many leads to assign.");
                          return;
                        }
                        if (!window.confirm(`Assign ${limit.toLocaleString("en-IN")} ${item.name} leads to ${member.name}?`)) return;
                        setAssigningId(member.userId);
                        void assignLeadCount(member.userId, limit)
                          .then(finish)
                          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign the leads"))
                          .finally(() => setAssigningId(""));
                      }}
                    >
                      <p className="text-sm sm:min-w-56">{member.name} · {productionRoleLabel(member.role)} · {held.toLocaleString("en-IN")} assigned</p>
                      <Input
                        type="number"
                        min={1}
                        max={Math.max(waiting, 1)}
                        required
                        placeholder="How many"
                        className="w-full sm:w-32"
                        value={assignCounts[member.userId] ?? ""}
                        onChange={(event) => setAssignCounts((current) => ({ ...current, [member.userId]: event.target.value }))}
                      />
                      <Button type="submit" disabled={Boolean(assigningId) || waiting < 1}>{assigningId === member.userId ? "Assigning…" : "Assign"}</Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={Boolean(assigningId) || held < 1}
                        onClick={() => {
                          if (!window.confirm(`Remove assignment from ${held.toLocaleString("en-IN")} leads held by ${member.name} on ${item.name}?`)) return;
                          setAssigningId(member.userId);
                          void clearAssignedLeads(member.userId)
                            .then((count) => {
                              setError("");
                              setNotice(`Removed assignment from ${count.toLocaleString("en-IN")} leads held by ${member.name}.`);
                              setPage(1);
                              setReload((value) => value + 1);
                            })
                            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove the assignment"))
                            .finally(() => setAssigningId(""));
                        }}
                      >
                        Remove assigned
                      </Button>
                      {people.length === 1 ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={Boolean(assigningId) || waiting < 1}
                          onClick={() => {
                            if (!window.confirm(`Assign all ${waiting.toLocaleString("en-IN")} waiting leads on ${item.name} to ${member.name}?`)) return;
                            setAssigningId(member.userId);
                            void assignUnassignedLeads(item.id, member.userId)
                              .then(finish)
                              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign the leads"))
                              .finally(() => setAssigningId(""));
                          }}
                        >
                          Assign all waiting
                        </Button>
                      ) : null}
                    </form>
                  );
                })}
              </div>
            );
          })}
        </section>
      ) : null}
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
                return listLeads({ page: 1, workspaceId, status, search, source, origin, unassigned, createdFrom: bounds.from, createdTo: bounds.to });
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
      {live ? (
        <section className="rounded-lg border border-line bg-white p-4">
          <p className="text-sm text-muted">Calling now</p>
          <p className="text-3xl font-semibold tabular">{formatClock(elapsed)}</p>
          <p className="mt-1 text-sm">{liveLead ? <Link to={`/leads/${liveLead.id}`}>{liveLead.fullName}</Link> : "This lead"}</p>
          <div className="mt-3">
            <CallResultButtons busy={callBusy} onResult={finishCall} />
          </div>
        </section>
      ) : null}
      <div className="space-y-3 lg:hidden">
        {leads.map((lead) => (
          <article key={lead.id} className="space-y-3 rounded-lg border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/leads/${lead.id}`} className="font-medium">{lead.fullName}</Link>
                <p className="text-xs text-muted">{leadOriginLabel(lead.status, lead.source, lead.sourcePlatform)}</p>
                <p className="text-xs text-muted">{formatLeadArrived(lead.createdAt)}</p>
              </div>
              <StatusBadge status={lead.status} />
            </div>
            <div className="flex items-center gap-2">
              <PhoneLink phone={lead.phone} onClick={() => { if (!live && !callBusy) beginCall(lead); }} />
              {canWhatsApp ? <WhatsAppLink phone={lead.phone} label={`Open WhatsApp for ${lead.fullName}`} /> : null}
            </div>
            <Select
              aria-label={`Stage for ${lead.fullName}`}
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
            <Select
              aria-label={`Assign ${lead.fullName}`}
              value={lead.assignedTo ?? ""}
              onChange={(event) => {
                const assignedTo = event.target.value;
                if (!assignedTo) {
                  if (!lead.assignedTo) return;
                  void clearLeadAssignment(lead)
                    .then(() => setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, assignedTo: null } : item))))
                    .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove the assignment"));
                  return;
                }
                void assignLead(lead, assignedTo)
                  .then(() => setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, assignedTo } : item))))
                  .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign the lead"));
              }}
            >
              <option value="">{lead.assignedTo ? "Remove assignment" : "Unassigned"}</option>
              {members.filter((member) => member.workspaceId === lead.workspaceId).map((member) => <option key={member.userId} value={member.userId}>{member.name} · {productionRoleLabel(member.role)}</option>)}
            </Select>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted">{formatClock(callStats[lead.id]?.talkSeconds ?? 0)} talk · {callStats[lead.id]?.dials ?? 0} dials · {callStats[lead.id]?.connected ?? 0} connected</p>
              {live?.leadId === lead.id ? (
                <p className="font-semibold tabular">{formatClock(elapsed)}</p>
              ) : (
                <Button asChild size="sm" disabled={callBusy || Boolean(live)}>
                  <a
                    href={phoneTel(lead.phone) || undefined}
                    onClick={(event) => {
                      if (callBusy || live || !phoneTel(lead.phone)) {
                        event.preventDefault();
                        if (!phoneTel(lead.phone)) setError("This lead has no phone number to dial.");
                        return;
                      }
                      beginCall(lead);
                    }}
                  >
                    Call
                  </a>
                </Button>
              )}
              <Button type="button" size="sm" variant="secondary" onClick={() => { setSheet({ lead, kind: "note" }); setSheetValue(""); }}>Note</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => { setSheet({ lead, kind: "follow" }); setSheetValue(""); }}>Follow-up</Button>
            </div>
          </article>
        ))}
        {leads.length === 0 && !loading ? <p className="rounded-lg border border-line bg-white px-4 py-8 text-center text-sm text-muted">No leads on this page.</p> : null}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-white lg:block">
        <table className="w-full min-w-[920px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["Name", "Came", "Phone", "Stage", "Assign", "Call", "Follow-up"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium">
                  <Link to={`/leads/${lead.id}`}>{lead.fullName}</Link>
                  <p className="text-xs text-muted">{leadOriginLabel(lead.status, lead.source, lead.sourcePlatform)}</p>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted">{formatLeadArrived(lead.createdAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <PhoneLink phone={lead.phone} onClick={() => { if (!live && !callBusy) beginCall(lead); }} />
                    {canWhatsApp ? <WhatsAppLink phone={lead.phone} label={`Open WhatsApp for ${lead.fullName}`} /> : null}
                  </div>
                </td>
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
                      if (!assignedTo) {
                        if (!lead.assignedTo) return;
                        void clearLeadAssignment(lead)
                          .then(() => setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, assignedTo: null } : item))))
                          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove the assignment"));
                        return;
                      }
                      void assignLead(lead, assignedTo)
                        .then(() => setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, assignedTo } : item))))
                        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign the lead"));
                    }}
                  >
                    <option value="">{lead.assignedTo ? "Remove assignment" : "Unassigned"}</option>
                    {members.filter((member) => member.workspaceId === lead.workspaceId).map((member) => <option key={member.userId} value={member.userId}>{member.name} · {productionRoleLabel(member.role)}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <p className="tabular">{formatClock(callStats[lead.id]?.talkSeconds ?? 0)}</p>
                  <p className="text-xs text-muted">{callStats[lead.id]?.dials ?? 0} dials · {callStats[lead.id]?.connected ?? 0} connected · {callStats[lead.id]?.rejected ?? 0} rejected</p>
                  {live?.leadId === lead.id ? (
                    <p className="mt-1 font-semibold tabular">{formatClock(elapsed)}</p>
                  ) : (
                    <Button asChild size="sm" className="mt-1" disabled={callBusy || Boolean(live)}>
                      <a
                        href={phoneTel(lead.phone) || undefined}
                        onClick={(event) => {
                          if (callBusy || live || !phoneTel(lead.phone)) {
                            event.preventDefault();
                            if (!phoneTel(lead.phone)) setError("This lead has no phone number to dial.");
                            return;
                          }
                          beginCall(lead);
                        }}
                      >
                        Call
                      </a>
                    </Button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => { setSheet({ lead, kind: "note" }); setSheetValue(""); }}>Note</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => { setSheet({ lead, kind: "follow" }); setSheetValue(""); }}>Follow-up</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && !loading ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted">No leads on this page.</p>
            <Button className="mt-3" type="button" disabled={!workspaces.length} onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import CSV
            </Button>
          </div>
        ) : null}
        <Pagination page={page} pages={pages} onPage={setPage} />
      </div>
      <ProductionImportDialog
        open={importOpen}
        workspaces={desk === "all" ? workspaces : workspaces.filter((item) => item.workspaceType === desk)}
        workspaceId={workspaceId}
        onOpenChange={setImportOpen}
        onImported={() => setReload((value) => value + 1)}
      />
    </div>
  );
}

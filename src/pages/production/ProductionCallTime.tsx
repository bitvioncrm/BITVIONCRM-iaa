import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CallResultButtons } from "@/components/calls/CallResultButtons";
import { useDialEndedAt } from "@/components/calls/useDialEndedAt";
import { useAuth } from "@/context/AuthContext";
import { formatClock, outcomeFromPhoneReturn, type CallOutcome } from "@/lib/call-time";
import { phoneTel } from "@/lib/phone";
import { canOperateWhatsApp, whatsAppDesk } from "@/lib/production-access";
import { listLeads, listWorkspaces, type ProductionLead, type WorkspaceOption } from "@/services/production-leads";
import { activeCall, callDeskReport, endCall, startCall, type LiveCall } from "@/services/production-ops";

const outcomeLabel: Record<CallOutcome, string> = {
  connected: "Connected",
  rejected: "Rejected",
  no_answer: "No answer",
};

export function ProductionCallTime() {
  const { productionUser } = useAuth();
  const desk = whatsAppDesk(productionUser?.roleKey ?? "");
  const seesEveryone = canOperateWhatsApp(productionUser?.roleKey ?? "");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<ProductionLead[]>([]);
  const [live, setLive] = useState<LiveCall | null>(null);
  const [now, setNow] = useState(0);
  const [report, setReport] = useState<Awaited<ReturnType<typeof callDeskReport>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returnedAt = useDialEndedAt(Boolean(live));
  const savedDial = useRef("");

  useEffect(() => {
    void listWorkspaces()
      .then((rows) => {
        const visible = desk === "clinic" || desk === "institute" ? rows.filter((item) => item.workspaceType === desk) : rows;
        setWorkspaces(visible);
        setWorkspaceId(visible[0]?.id ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, [desk]);

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
    if (!workspaceId) return;
    void callDeskReport(workspaceId, seesEveryone)
      .then(setReport)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load call time"));
  }, [workspaceId, seesEveryone, live]);

  useEffect(() => {
    if (!workspaceId) return;
    void listLeads({ workspaceId, search, page: 1 })
      .then((result) => setLeads(result.leads))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load leads"));
  }, [workspaceId, search]);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const speaking = live ? leads.find((lead) => lead.id === live.leadId) : undefined;
  const elapsed = live ? Math.max(0, Math.floor(((returnedAt ? new Date(returnedAt).getTime() : now) - new Date(live.startedAt).getTime()) / 1000)) : 0;
  const title = desk === "institute" ? "Institute call time" : desk === "clinic" ? "Clinic call time" : "Call time";

  function finish(outcome: CallOutcome, endedAt?: string) {
    if (!live || savedDial.current === live.id) return;
    savedDial.current = live.id;
    setBusy(true);
    void endCall(live.id, outcome, endedAt)
      .then(() => {
        setLive(null);
        setError("");
      })
      .catch((reason: unknown) => {
        savedDial.current = "";
        setError(reason instanceof Error ? reason.message : "End call failed");
      })
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    if (!live || !returnedAt) return;
    const seconds = Math.max(0, Math.floor((new Date(returnedAt).getTime() - new Date(live.startedAt).getTime()) / 1000));
    finish(outcomeFromPhoneReturn(seconds), returnedAt);
  }, [live, returnedAt]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {workspaces.length > 1 ? (
        <select className="rounded-md border border-line px-2 py-2" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
          {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      ) : (
        <p className="text-sm font-medium">{workspace?.name}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total dials" value={String(report?.dials ?? 0)} />
        <Stat label="Connected" value={String(report?.connected ?? 0)} />
        <Stat label="Rejected" value={String(report?.rejected ?? 0)} />
        <Stat label="No answer" value={String(report?.noAnswer ?? 0)} />
        <Stat label="Talk time" value={formatClock(report?.talkSeconds ?? 0)} />
      </div>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="font-semibold">While calling</h2>
        {live ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm">{speaking?.fullName ?? "Lead"} · {workspace?.name}</p>
            <p className="text-4xl font-semibold tabular">{formatClock(elapsed)}</p>
            <CallResultButtons busy={busy} onResult={finish} />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search a lead by name or phone"
              className="w-full max-w-md rounded-md border border-line px-2 py-2"
            />
            <div className="max-h-64 space-y-2 overflow-auto">
              {leads.map((lead) => (
                <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                  <div>
                    <Link className="font-medium" to={`/leads/${lead.id}`}>{lead.fullName}</Link>
                    <p className="text-xs text-muted">{lead.phone}</p>
                  </div>
                  <a
                    href={phoneTel(lead.phone) || undefined}
                    className="rounded-md bg-navy px-3 py-1.5 text-sm text-white aria-disabled:opacity-50"
                    aria-disabled={busy || !workspace || !phoneTel(lead.phone)}
                    onClick={(event) => {
                      if (!workspace || busy || !phoneTel(lead.phone)) {
                        event.preventDefault();
                        if (!phoneTel(lead.phone)) setError("This lead has no phone number to dial.");
                        return;
                      }
                      setBusy(true);
                      void startCall(workspace.organizationId, workspace.id, lead.id)
                        .then((row) => {
                          setLive(row);
                          setError("");
                        })
                        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Start call failed"))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Call
                  </a>
                </div>
              ))}
              {leads.length === 0 ? <p className="text-sm text-muted">No leads on this desk.</p> : null}
            </div>
          </div>
        )}
      </section>
      <section className="space-y-2 lg:hidden">
        {(report?.calls ?? []).map((call, index) => (
          <article key={`${call.leadId}-${call.startedAt}-${index}`} className="rounded-lg border border-line bg-white p-3 text-sm">
            <p className="font-medium">{call.leadId ? <Link to={`/leads/${call.leadId}`}>{call.leadName}</Link> : call.leadName}</p>
            <p className="text-muted">{outcomeLabel[call.outcome]} · {call.outcome === "connected" ? formatClock(call.talkSeconds) : "No talk time"}</p>
          </article>
        ))}
        {(report?.calls.length ?? 0) === 0 ? <p className="rounded-lg border border-line bg-white px-3 py-6 text-sm text-muted">No completed dials today.</p> : null}
      </section>
      <section className="hidden overflow-x-auto rounded-lg border border-line bg-white lg:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              {["Lead", "Result", "Talk time"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}
            </tr>
          </thead>
          <tbody>
            {(report?.calls ?? []).map((call, index) => (
              <tr key={`${call.leadId}-${call.startedAt}-${index}`} className="border-b border-line last:border-0">
                <td className="px-3 py-2">{call.leadId ? <Link to={`/leads/${call.leadId}`}>{call.leadName}</Link> : call.leadName}</td>
                <td className="px-3 py-2">{outcomeLabel[call.outcome]}</td>
                <td className="px-3 py-2 tabular">{call.outcome === "connected" ? formatClock(call.talkSeconds) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(report?.calls.length ?? 0) === 0 ? <p className="px-3 py-6 text-sm text-muted">No completed dials today.</p> : null}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DialLink } from "@/components/calls/DialLink";
import { useAuth } from "@/context/AuthContext";
import { useCallSession } from "@/context/CallSessionContext";
import { formatCallWhen, formatClock, type CallOutcome } from "@/lib/call-time";
import { canOperateWhatsApp, whatsAppDesk } from "@/lib/production-access";
import { listLeads, listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { callDeskReport } from "@/services/production-ops";

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
  const [leads, setLeads] = useState<Awaited<ReturnType<typeof listLeads>>["leads"]>([]);
  const [report, setReport] = useState<Awaited<ReturnType<typeof callDeskReport>> | null>(null);
  const [error, setError] = useState("");
  const { live, elapsed } = useCallSession();

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
    if (!workspaceId) return;
    const load = () => {
      void callDeskReport(workspaceId, seesEveryone)
        .then(setReport)
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load call time"));
    };
    load();
    window.addEventListener("bitvion-call-saved", load);
    return () => window.removeEventListener("bitvion-call-saved", load);
  }, [workspaceId, seesEveryone]);

  useEffect(() => {
    if (!workspaceId) return;
    void listLeads({ workspaceId, search, page: 1 })
      .then((result) => setLeads(result.leads))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load leads"));
  }, [workspaceId, search]);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const title = desk === "institute" ? "Institute call time" : desk === "clinic" ? "Clinic call time" : "Call time";

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total dials" value={String(report?.dials ?? 0)} />
        <Stat label="Connected" value={String(report?.connected ?? 0)} />
        <Stat label="Rejected" value={String(report?.rejected ?? 0)} />
        <Stat label="No answer" value={String(report?.noAnswer ?? 0)} />
        <Stat label="Call time" value={formatClock(report?.callSeconds ?? 0)} />
        <Stat label="Talk time" value={formatClock(report?.talkSeconds ?? 0)} />
      </div>
      <section className="rounded-2xl border border-[#eadfca] bg-white p-4">
        <h2 className="font-semibold">Call someone</h2>
        {live ? (
          <div className="mt-3">
            <p className="text-sm text-muted">{live.name || "Call"} · timer is running</p>
            <p className="mt-1 text-4xl font-semibold tabular">{formatClock(elapsed)}</p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search a lead by name or phone"
              className="h-11 w-full max-w-md rounded-md border border-line px-3"
            />
            <div className="max-h-64 space-y-2 overflow-auto">
              {leads.map((lead) => (
                <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                  <div>
                    <Link className="font-medium" to={`/leads/${lead.id}`}>{lead.fullName}</Link>
                    <p className="text-xs text-muted">{lead.phone}</p>
                  </div>
                  {workspace ? <DialLink organizationId={workspace.organizationId} workspaceId={workspace.id} leadId={lead.id} name={lead.fullName} phone={lead.phone} className="inline-flex min-h-11 items-center rounded-md bg-navy px-3 text-sm text-white" /> : null}
                </div>
              ))}
              {leads.length === 0 ? <p className="text-sm text-muted">No leads on this desk.</p> : null}
            </div>
          </div>
        )}
      </section>
      <section className="space-y-2 lg:hidden">
        {(report?.calls ?? []).map((call, index) => (
          <article key={`${call.leadId}-${call.startedAt}-${index}`} className="rounded-2xl border border-line bg-white p-3 text-sm">
            <p className="font-medium">{call.leadId ? <Link to={`/leads/${call.leadId}`}>{call.leadName}</Link> : call.leadName}</p>
            <p className="mt-1 text-muted">{outcomeLabel[call.outcome]} · {formatClock(call.talkSeconds)}</p>
            <p className="text-xs text-muted">{formatCallWhen(call.startedAt)}{call.endedAt ? ` – ${formatCallWhen(call.endedAt)}` : ""}</p>
          </article>
        ))}
        {(report?.calls.length ?? 0) === 0 ? <p className="rounded-2xl border border-line bg-white px-3 py-6 text-sm text-muted">No completed dials today.</p> : null}
      </section>
      <section className="hidden overflow-x-auto rounded-2xl border border-line bg-white lg:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              {["Person", "Started", "Ended", "Length", "Result"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}
            </tr>
          </thead>
          <tbody>
            {(report?.calls ?? []).map((call, index) => (
              <tr key={`${call.leadId}-${call.startedAt}-${index}`} className="border-b border-line last:border-0">
                <td className="px-3 py-2">{call.leadId ? <Link to={`/leads/${call.leadId}`}>{call.leadName}</Link> : call.leadName}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatCallWhen(call.startedAt)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{call.endedAt ? formatCallWhen(call.endedAt) : ""}</td>
                <td className="px-3 py-2 tabular">{formatClock(call.talkSeconds)}</td>
                <td className="px-3 py-2">{outcomeLabel[call.outcome]}</td>
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

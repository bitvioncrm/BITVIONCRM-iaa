import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useDesk } from "@/context/DeskContext";
import { productionRoleLabel } from "@/lib/production-access";
import { ChannelSettings } from "@/pages/production/ChannelSettings";
import { Button } from "@/components/ui/button";
import { formatLeadArrived } from "@/lib/dates";
import { assignMetaLead, linkWhatsAppFromMeta, listDeskTelecallers, loadMetaCentre, pullMetaLeadsNow, retryMetaImport, saveFormMapping, setMappingActive, type DeskCaller, type MetaCentre } from "@/services/meta-admin";
import { clearLeadAssignment, listWorkspaces, type WorkspaceOption } from "@/services/production-leads";

const EMPTY: MetaCentre = {
  status: "configuration_required",
  detail: "Meta integration is not configured.",
  lastSuccessAt: null,
  lastEventAt: null,
  failed: 0,
  mappings: [],
  events: [],
  clinic: {},
  institute: {},
  leads: [],
  schemaReady: true,
};

function Count({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="px-3 py-2">
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular">{value == null ? "—" : value.toLocaleString("en-IN")}</p>
    </div>
  );
}

export function MetaLeadCentre() {
  const { desk, bounds } = useDesk();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [callers, setCallers] = useState<DeskCaller[]>([]);
  const [savingId, setSavingId] = useState("");
  const [centre, setCentre] = useState<MetaCentre>(EMPTY);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState("");
  const [form, setForm] = useState("");
  const [status, setStatus] = useState("");
  const [assigned, setAssigned] = useState("");
  const [reload, setReload] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [linking, setLinking] = useState(false);
  const silentRef = useRef(false);

  useEffect(() => {
    let active = true;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) setLoading(true);
    void listWorkspaces()
      .then((rows) => {
        if (!active) return;
        setWorkspaces(rows);
        void listDeskTelecallers(rows).then((people) => {
          if (active) setCallers(people);
        }).catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : "Telecallers could not be loaded");
        });
        const selected = desk === "all" ? rows : rows.filter((item) => item.workspaceType === desk);
        return loadMetaCentre(rows, selected.map((item) => item.id), bounds.from, bounds.to, { campaign, form, status, assignedTo: assigned });
      })
      .then((result) => {
        if (active && result) setCentre(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Meta leads could not be loaded");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assigned, bounds.from, bounds.to, campaign, desk, form, reload, status]);

  useEffect(() => {
    const refresh = () => {
      silentRef.current = true;
      setReload((value) => value + 1);
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
  }, []);

  const connected = centre.status === "connected";
  const showCounts = connected || centre.leads.length > 0 || centre.failed > 0;
  const workspaceName = (id: string) => workspaces.find((item) => item.id === id)?.name ?? "Desk";
  const clinicCallers = callers.filter((item) => item.desk === "clinic");
  const instituteCallers = callers.filter((item) => item.desk === "institute");

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const workspace = workspaces.find((item) => item.id === String(data.get("workspace")));
    if (!workspace) return;
    setNotice("");
    void saveFormMapping({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      pageId: String(data.get("page") ?? ""),
      formId: String(data.get("form") ?? ""),
      formName: String(data.get("name") ?? ""),
    })
      .then(() => {
        setNotice("Form mapping saved.");
        event.currentTarget.reset();
        setReload((value) => value + 1);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The mapping could not be saved"));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-accent uppercase">Meta Lead Centre · {bounds.label}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Meta leads</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={linking}
            onClick={() => {
              setLinking(true);
              setNotice("");
              setError("");
              void linkWhatsAppFromMeta()
                .then((result) => {
                  if (result.linked > 0) setNotice(`${result.linked} WhatsApp desk${result.linked === 1 ? "" : "s"} linked from Meta. Click leads can arrive live.`);
                  else if (result.phones > 0) setNotice("WhatsApp numbers were found in Meta. Match the display number in Settings, then save.");
                  else setNotice("No Cloud API WhatsApp number is available on this Meta token yet. Use Instant Forms for lead phone numbers, or paste Phone number ID from WhatsApp Manager → API setup.");
                  silentRef.current = true;
                  setReload((value) => value + 1);
                })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "WhatsApp could not be linked"))
                .finally(() => setLinking(false));
            }}
          >
            {linking ? "Linking…" : "Link WhatsApp from Meta"}
          </Button>
          <Button
            type="button"
            disabled={pulling}
            onClick={() => {
              setPulling(true);
              setNotice("");
              setError("");
              void pullMetaLeadsNow()
                .then((result) => {
                  setNotice(result.stored > 0 ? `${result.stored} new Meta leads pulled.` : "Meta forms are current. Every form lead is already in the CRM.");
                  silentRef.current = true;
                  setReload((value) => value + 1);
                  if (result.stored > 0) window.dispatchEvent(new CustomEvent("bitvion-lead", { detail: { fullName: `${result.stored} Meta leads` } }));
                })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Meta leads could not be pulled"))
                .finally(() => setPulling(false));
            }}
          >
            {pulling ? "Pulling…" : "Pull Meta leads now"}
          </Button>
        </div>
      </header>
      <ChannelSettings embedded />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{notice}</p> : null}
      <section className={`rounded-lg border px-4 py-3 ${connected ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <p className="text-sm font-semibold">{connected ? "Connected" : "Not connected"}</p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div><dt className="text-muted">Last successful sync</dt><dd>{centre.lastSuccessAt ? new Date(centre.lastSuccessAt).toLocaleString("en-IN") : "None"}</dd></div>
          <div><dt className="text-muted">Last lead received</dt><dd>{centre.lastEventAt ? new Date(centre.lastEventAt).toLocaleString("en-IN") : "None"}</dd></div>
          <div><dt className="text-muted">Failed or unmapped</dt><dd className="tabular">{centre.failed}</dd></div>
        </dl>
      </section>

      {!centre.schemaReady ? <p className="text-sm text-muted">{centre.detail}</p> : (
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">Form to desk</h2>
          <form className="mt-3 grid gap-2 md:grid-cols-5" onSubmit={onSave}>
            <input name="page" required placeholder="Page ID" className="h-11 rounded-md border border-line px-2 text-base sm:h-9 sm:text-sm" />
            <input name="form" required placeholder="Form ID" className="h-11 rounded-md border border-line px-2 text-base sm:h-9 sm:text-sm" />
            <input name="name" placeholder="Form name" className="h-11 rounded-md border border-line px-2 text-base sm:h-9 sm:text-sm" />
            <select name="workspace" required className="h-11 rounded-md border border-line px-2 text-base sm:h-9 sm:text-sm" defaultValue={workspaces.find((item) => item.workspaceType === "clinic")?.id ?? ""}>
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="h-11 rounded-md bg-accent px-3 text-sm font-medium text-white sm:h-9" type="submit">Save mapping</button>
          </form>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-xs text-muted"><tr>{["Form", "Page", "Form ID", "Desk", "State", ""].map((heading) => <th key={heading} className="px-2 py-2 font-medium">{heading}</th>)}</tr></thead>
              <tbody>
                {centre.mappings.length === 0 ? <tr><td className="px-2 py-4 text-muted" colSpan={6}>No form mappings yet.</td></tr> : centre.mappings.map((mapping) => (
                  <tr key={mapping.id} className="border-t border-line">
                    <td className="px-2 py-2">{mapping.formName || "Untitled form"}</td>
                    <td className="px-2 py-2">{mapping.pageId || "Any page"}</td>
                    <td className="px-2 py-2">{mapping.formId}</td>
                    <td className="px-2 py-2">{workspaceName(mapping.workspaceId)}</td>
                    <td className="px-2 py-2">{mapping.active ? "Active" : "Inactive"}</td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" className="text-xs font-medium text-accent" onClick={() => { void setMappingActive(mapping.id, !mapping.active).then(() => setReload((value) => value + 1)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not update the mapping")); }}>
                        {mapping.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showCounts ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Clinic Meta leads" counts={centre.clinic} />
          <Panel title="Institute Meta leads" counts={centre.institute} />
        </div>
      ) : (
        <p className="text-sm text-muted">No Meta leads yet.</p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Imported leads</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <input value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Campaign" className="rounded-md border border-line bg-white px-2 py-2" />
          <input value={form} onChange={(event) => setForm(event.target.value)} placeholder="Form" className="rounded-md border border-line bg-white px-2 py-2" />
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-line bg-white px-2 py-2">
            <option value="">Lead status</option>
            {["new", "contacted", "interested", "follow_up", "converted", "lost"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={assigned} onChange={(event) => setAssigned(event.target.value)} className="rounded-md border border-line bg-white px-2 py-2">
            <option value="">Assignment</option>
            <option value="unassigned">Unassigned</option>
            <optgroup label="Clinic telecallers">
              {clinicCallers.map((caller) => <option key={`${caller.workspaceId}:${caller.userId}`} value={caller.userId}>{caller.name}</option>)}
            </optgroup>
            <optgroup label="Institute telecallers">
              {instituteCallers.map((caller) => <option key={`${caller.workspaceId}:${caller.userId}`} value={caller.userId}>{caller.name}</option>)}
            </optgroup>
          </select>
        </div>
        {loading ? <p className="text-sm text-muted">Loading Meta records…</p> : null}
        <div className="space-y-3 lg:hidden">
          {centre.leads.map((lead) => {
            const workspace = workspaces.find((item) => item.id === lead.workspaceId);
            const deskCallers = callers.filter((item) => item.workspaceId === lead.workspaceId);
            const known = deskCallers.some((item) => item.userId === lead.assignedTo);
            return (
              <article key={lead.id} className="space-y-2 rounded-lg border border-line p-3">
                <Link to={`/leads/${lead.id}`} className="font-medium">{lead.name}</Link>
                <p className="text-xs text-muted">{lead.phone || "No number"} · {formatLeadArrived(lead.createdAt)} · {workspaceName(lead.workspaceId)} · {lead.status}</p>
                <p className="text-xs text-muted">{lead.campaign || "No campaign"} · {lead.form || "No form"}</p>
                <select
                  aria-label={`Assign ${lead.name}`}
                  className="h-11 w-full rounded-md border border-line bg-white px-2 text-base"
                  value={lead.assignedTo ?? ""}
                  disabled={savingId === lead.id || !workspace}
                  onChange={(event) => {
                    const assignedTo = event.target.value;
                    if (!workspace) return;
                    if (!assignedTo) {
                      if (!lead.assignedTo) return;
                      setSavingId(lead.id);
                      setError("");
                      void clearLeadAssignment({ id: lead.id, organizationId: workspace.organizationId, workspaceId: lead.workspaceId })
                        .then(() => {
                          setNotice(`Assignment removed from ${lead.name}.`);
                          setCentre((current) => ({
                            ...current,
                            leads: current.leads.map((item) => (item.id === lead.id ? { ...item, assignedTo: null } : item)),
                          }));
                        })
                        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove the assignment"))
                        .finally(() => setSavingId(""));
                      return;
                    }
                    setSavingId(lead.id);
                    setError("");
                    void assignMetaLead({
                      leadId: lead.id,
                      organizationId: workspace.organizationId,
                      workspaceId: lead.workspaceId,
                      workspaceType: workspace.workspaceType,
                      assignedTo,
                    })
                      .then(() => {
                        const caller = deskCallers.find((item) => item.userId === assignedTo);
                        setNotice(`${lead.name} assigned to ${caller?.name ?? "the telecaller"}.`);
                        setCentre((current) => ({
                          ...current,
                          leads: current.leads.map((item) => (item.id === lead.id ? { ...item, assignedTo } : item)),
                        }));
                      })
                      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign the lead"))
                      .finally(() => setSavingId(""));
                  }}
                >
                  <option value="">{lead.assignedTo ? "Remove assignment" : workspace?.workspaceType === "institute" ? "Choose an institute telecaller" : "Choose a clinic telecaller"}</option>
                  {lead.assignedTo && !known ? <option value={lead.assignedTo}>Current assignee</option> : null}
                  {deskCallers.map((caller) => <option key={caller.userId} value={caller.userId}>{caller.name} · {productionRoleLabel(caller.role)}</option>)}
                </select>
              </article>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-line bg-white lg:block">
          {centre.leads.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No Meta forms or WhatsApp clicks in this desk and date range.</p> : (
            <table className="w-full min-w-[880px] text-left text-[13px]">
              <thead className="text-xs text-muted"><tr>{["Name", "Phone", "Came", "Desk", "Status", "Campaign", "Form", "Telecaller"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
              <tbody>
                {centre.leads.map((lead) => {
                  const workspace = workspaces.find((item) => item.id === lead.workspaceId);
                  const deskCallers = callers.filter((item) => item.workspaceId === lead.workspaceId);
                  const known = deskCallers.some((item) => item.userId === lead.assignedTo);
                  return (
                    <tr key={lead.id} className="border-t border-line">
                      <td className="px-3 py-2 font-medium"><Link to={`/leads/${lead.id}`} className="hover:text-accent">{lead.name}</Link></td>
                      <td className="px-3 py-2 whitespace-nowrap">{lead.phone || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-muted">{formatLeadArrived(lead.createdAt)}</td>
                      <td className="px-3 py-2">{workspaceName(lead.workspaceId)}</td>
                      <td className="px-3 py-2">{lead.status}</td>
                      <td className="px-3 py-2">{lead.campaign || "—"}</td>
                      <td className="px-3 py-2">{lead.form || "—"}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Assign ${lead.name}`}
                          className="w-full min-w-44 rounded-md border border-line bg-white px-2 py-1.5"
                          value={lead.assignedTo ?? ""}
                          disabled={savingId === lead.id || !workspace}
                          onChange={(event) => {
                            const assignedTo = event.target.value;
                            if (!workspace) return;
                            if (!assignedTo) {
                              if (!lead.assignedTo) return;
                              setSavingId(lead.id);
                              setError("");
                              void clearLeadAssignment({ id: lead.id, organizationId: workspace.organizationId, workspaceId: lead.workspaceId })
                                .then(() => {
                                  setNotice(`Assignment removed from ${lead.name}.`);
                                  setCentre((current) => ({
                                    ...current,
                                    leads: current.leads.map((item) => (item.id === lead.id ? { ...item, assignedTo: null } : item)),
                                  }));
                                })
                                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove the assignment"))
                                .finally(() => setSavingId(""));
                              return;
                            }
                            setSavingId(lead.id);
                            setError("");
                            void assignMetaLead({
                              leadId: lead.id,
                              organizationId: workspace.organizationId,
                              workspaceId: lead.workspaceId,
                              workspaceType: workspace.workspaceType,
                              assignedTo,
                            })
                              .then(() => {
                                const caller = deskCallers.find((item) => item.userId === assignedTo);
                                setNotice(`${lead.name} assigned to ${caller?.name ?? "the telecaller"}.`);
                                setCentre((current) => ({
                                  ...current,
                                  leads: current.leads.map((item) => (item.id === lead.id ? { ...item, assignedTo } : item)),
                                }));
                              })
                              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign the lead"))
                              .finally(() => setSavingId(""));
                          }}
                        >
                          <option value="">{lead.assignedTo ? "Remove assignment" : workspace?.workspaceType === "institute" ? "Choose an institute telecaller" : "Choose a clinic telecaller"}</option>
                          {lead.assignedTo && !known ? <option value={lead.assignedTo}>Current assignee</option> : null}
                          {deskCallers.map((caller) => <option key={caller.userId} value={caller.userId}>{caller.name} · {productionRoleLabel(caller.role)}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Failed imports</h2>
        </div>
        {centre.events.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No failed imports.</p> : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-muted"><tr>{["Form", "Page", "Status", "Error", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
            <tbody>
              {centre.events.map((item) => (
                <tr key={item.id} className="border-t border-line">
                  <td className="px-3 py-2">{item.formId || "—"}</td>
                  <td className="px-3 py-2">{item.pageId || "—"}</td>
                  <td className="px-3 py-2">{item.status}</td>
                  <td className="px-3 py-2">{item.errorCode || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-accent"
                      onClick={() => {
                        void retryMetaImport(item.leadgenId)
                          .then((result) => setNotice(result === "unmapped" ? "Still unmapped. Check the form ID and page ID." : "Import processed."))
                          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Retry failed"))
                          .finally(() => setReload((value) => value + 1));
                      }}
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Panel({ title, counts }: { title: string; counts: Record<string, number | null> }) {
  return (
    <section className="rounded-lg border border-line bg-white">
      <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <Count label="New Meta leads" value={counts.fresh} />
        <Count label="Forms today" value={counts.today} />
        <Count label="WhatsApp clicks" value={counts.clicks} />
        <Count label="Clicks today" value={counts.clicksToday} />
        <Count label="Unassigned" value={counts.unassigned} />
        <Count label="Assigned" value={counts.assigned} />
        <Count label="Contacted" value={counts.contacted} />
        <Count label="Converted" value={counts.converted} />
      </div>
    </section>
  );
}

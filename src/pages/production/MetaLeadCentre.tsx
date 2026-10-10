import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useDesk } from "@/context/DeskContext";
import { productionRoleLabel } from "@/lib/production-access";
import { assignMetaLead, listDeskTelecallers, loadMetaCentre, retryMetaImport, saveFormMapping, setMappingActive, type DeskCaller, type MetaCentre } from "@/services/meta-admin";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";

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

  useEffect(() => {
    let active = true;
    setLoading(true);
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

  const connected = centre.status === "connected";
  const configured = connected || centre.mappings.some((item) => item.active);
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
        setNotice("Form mapping saved. New leads from that form will use this desk.");
        event.currentTarget.reset();
        setReload((value) => value + 1);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The mapping could not be saved"));
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium tracking-wide text-accent uppercase">Meta Lead Centre · {bounds.label}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Meta leads</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Leads are routed by the Facebook Page and lead form you map here. Campaign names are stored when Meta sends them, and they are not used to choose a desk.</p>
      </header>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{notice}</p> : null}
      <section className={`rounded-lg border px-4 py-3 ${connected ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <p className="text-sm font-semibold">{connected ? "Connected" : "Meta integration is not configured."}</p>
        <p className="mt-1 text-sm text-muted">
          {connected ? centre.detail || "The last webhook stored a lead." : "Setup required. This screen will not show a connected state until a verified webhook stores a lead."}
        </p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div><dt className="text-muted">Last successful sync</dt><dd>{centre.lastSuccessAt ? new Date(centre.lastSuccessAt).toLocaleString("en-IN") : "None"}</dd></div>
          <div><dt className="text-muted">Last webhook event</dt><dd>{centre.lastEventAt ? new Date(centre.lastEventAt).toLocaleString("en-IN") : "None"}</dd></div>
          <div><dt className="text-muted">Failed or unmapped</dt><dd className="tabular">{centre.failed}</dd></div>
        </dl>
      </section>

      {!centre.schemaReady ? <p className="text-sm text-muted">{centre.detail}</p> : (
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">Form to desk</h2>
          <p className="mt-1 text-sm text-muted">Use the Page ID and Lead Form ID from Meta. One active mapping per form and page. Tokens stay in server environment variables and are not entered here.</p>
          <form className="mt-3 grid gap-2 md:grid-cols-5" onSubmit={onSave}>
            <input name="page" required placeholder="Page ID" className="rounded-md border border-line px-2 py-2" />
            <input name="form" required placeholder="Form ID" className="rounded-md border border-line px-2 py-2" />
            <input name="name" placeholder="Form name" className="rounded-md border border-line px-2 py-2" />
            <select name="workspace" required className="rounded-md border border-line px-2 py-2" defaultValue={workspaces.find((item) => item.workspaceType === "clinic")?.id ?? ""}>
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">Save mapping</button>
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
          <div className="mt-4 rounded-md bg-canvas px-3 py-3 text-xs text-muted">
            <p className="font-medium text-ink">Server setup</p>
            <p className="mt-1">Webhook: <span className="font-mono">/.netlify/functions/meta-leadgen</span></p>
            <p className="mt-1">Required environment variables: META_VERIFY_TOKEN, META_APP_SECRET, META_PAGE_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_ORGANIZATION_ID. Do not put these in the frontend.</p>
            {!configured ? <p className="mt-2">Meta integration is not configured.</p> : null}
          </div>
        </section>
      )}

      {showCounts ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Clinic Meta leads" counts={centre.clinic} />
          <Panel title="Institute Meta leads" counts={centre.institute} />
        </div>
      ) : (
        <p className="text-sm text-muted">No Meta lead counts are shown until the integration is connected or imported leads exist.</p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Imported leads</h2>
        <p className="text-sm text-muted">Clinic leads can be assigned only to a clinic telecaller. Institute leads can be assigned only to an institute telecaller.</p>
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
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          {centre.leads.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No Meta leads in this desk and date range.</p> : (
            <table className="w-full min-w-[880px] text-left text-[13px]">
              <thead className="text-xs text-muted"><tr>{["Name", "Desk", "Status", "Campaign", "Form", "Telecaller"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
              <tbody>
                {centre.leads.map((lead) => {
                  const workspace = workspaces.find((item) => item.id === lead.workspaceId);
                  const deskCallers = callers.filter((item) => item.workspaceId === lead.workspaceId);
                  const known = deskCallers.some((item) => item.userId === lead.assignedTo);
                  return (
                    <tr key={lead.id} className="border-t border-line">
                      <td className="px-3 py-2 font-medium"><Link to={`/leads/${lead.id}`} className="hover:text-accent">{lead.name}</Link></td>
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
                            if (!assignedTo || !workspace) return;
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
                          <option value="">{lead.assignedTo && !known ? "Assigned" : workspace?.workspaceType === "institute" ? "Choose an institute telecaller" : "Choose a clinic telecaller"}</option>
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
          <p className="text-xs text-muted">These rows store the form and error only. Contact details stay on the lead after a successful retry.</p>
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
        <Count label="Imported today" value={counts.today} />
        <Count label="Unassigned" value={counts.unassigned} />
        <Count label="Assigned" value={counts.assigned} />
        <Count label="Contacted" value={counts.contacted} />
        <Count label="Converted" value={counts.converted} />
      </div>
    </section>
  );
}

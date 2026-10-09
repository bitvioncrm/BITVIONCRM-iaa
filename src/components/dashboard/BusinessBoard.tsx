import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDesk, type DeskKey } from "@/context/DeskContext";
import { inr } from "@/lib/money";
import { loadOverview, type Overview } from "@/services/overview";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";

const tooltipStyle = { border: "1px solid #e6e8ee", borderRadius: 8, fontSize: 12 };

function text(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-IN");
}

function money(value: number | null) {
  return value === null ? "—" : inr(value);
}

function Kpi({ label, value, detail, to }: { label: string; value: string; detail: string; to: string }) {
  return (
    <Link to={to} className="block rounded-lg border border-line bg-white px-4 py-3 transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-[26px] leading-none font-semibold tabular">{value}</p>
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </Link>
  );
}

function Action({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="inline-flex h-8 items-center rounded-md border border-line bg-white px-2.5 text-[13px] font-medium hover:border-accent hover:text-accent">
      {children}
    </Link>
  );
}

export function BusinessBoard({ desk, variant = "full" }: { desk: DeskKey; variant?: "full" | "operations" }) {
  const { bounds, rangeKey } = useDesk();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listWorkspaces()
      .then(async (rows) => {
        if (!active) return;
        setWorkspaces(rows);
        const overview = await loadOverview(rows, desk, bounds, rangeKey === "today" || rangeKey === "yesterday");
        if (!active) return;
        setData(overview);
        setError("");
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The overview could not be loaded");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bounds, desk, rangeKey]);

  const clinic = workspaces.find((item) => item.workspaceType === "clinic");
  const institute = workspaces.find((item) => item.workspaceType === "institute");
  const leadTo = (target: "clinic" | "institute" | DeskKey, extra?: Record<string, string>) => {
    const params = new URLSearchParams({ from: bounds.from, to: bounds.to, ...extra });
    if (target !== "all") params.set("desk", target);
    return `/leads?${params.toString()}`;
  };
  const heading = desk === "clinic" ? "Clinic Overview" : desk === "institute" ? "Institute Overview" : "Business Overview";
  const subtitle = desk === "clinic"
    ? "Clinic leads, patients, appointments, inventory, and collections for the selected dates."
    : desk === "institute"
      ? "Institute enquiries, admissions, students, and collections for the selected dates."
      : "Monitor clinic operations, institute admissions, lead conversion, inventory, collections, and team activity from one place.";
  const showClinic = desk !== "institute";
  const showInstitute = desk !== "clinic";
  const chartsReady = Boolean(data && !data.chartNote);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium tracking-wide text-accent uppercase">{bounds.label}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{heading}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>
      </header>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {data?.errors.length ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.errors[0]}</p> : null}
      {loading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => <div key={index} className="h-[92px] animate-pulse rounded-lg border border-line bg-white" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Total leads" value={text(data.leads)} detail="Created in this range" to={leadTo(desk)} />
            <Kpi label="New leads" value={text(data.newLeads)} detail="Still in New" to={leadTo(desk, { status: "new" })} />
            {showClinic ? <Kpi label="Registered patients" value={text(data.patients)} detail={`${text(data.newPatients)} new in this range`} to="/clinic" /> : null}
            {showInstitute ? <Kpi label="Registered students" value={text(data.students)} detail={`${text(data.newStudents)} new in this range`} to="/institute" /> : null}
            {showClinic ? <Kpi label="Appointments" value={text(data.appointments)} detail="Scheduled in this range" to="/clinic" /> : null}
            {showInstitute ? <Kpi label="Admissions" value={text(data.admissions)} detail="Admitted in this range" to="/institute" /> : null}
            <Kpi label="Collections" value={money(data.collections)} detail="Recorded payments, not invoices" to="/billing" />
            <Kpi label="Outstanding" value={money(data.outstanding)} detail="Current unpaid invoice balance" to="/billing" />
            <Kpi label="Pending follow-ups" value={text(data.followupsPending)} detail={`${text(data.followupsOverdue)} overdue · current queue`} to="/follow-ups" />
            {showClinic ? <Kpi label="Inventory alerts" value={text(data.inventoryAlerts)} detail={`${text(data.lowStock)} low · ${text(data.expiring)} expiring`} to="/inventory" /> : null}
          </div>

          {showClinic ? (
            <section className="space-y-3">
              <h2 className="border-l-2 border-accent pl-2 text-sm font-semibold">Dr. K’s Aesthetic Clinic</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Clinic leads" value={text(data.clinicLeads)} detail="Created in this range" to={leadTo("clinic")} />
                <Kpi label="Today's appointments" value={text(data.todayAppointments)} detail={`${text(data.pendingAppointments)} pending · ${text(data.completedAppointments)} completed in range`} to="/clinic" />
                <Kpi label="Clinic collections" value={money(data.collectionsByDesk.find((row) => row.name === "Clinic")?.amount ?? (desk === "clinic" ? data.collections : null))} detail="Clinic payments only" to="/billing" />
                <Kpi label="Low stock / expiry" value={text(data.inventoryAlerts)} detail={`${text(data.lowStock)} low · ${text(data.expiring)} expiring`} to="/inventory" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Action to={leadTo("clinic")}>View clinic leads</Action>
                <Action to="/clinic">Add patient</Action>
                <Action to="/clinic">Register patient</Action>
                <Action to="/clinic">View appointments</Action>
                <Action to="/clinic">Open patient records</Action>
                <Action to="/inventory">Manage inventory</Action>
                <Action to="/billing">View clinic collections</Action>
                <Action to="/reports">Open clinic reports</Action>
              </div>
            </section>
          ) : null}

          {showInstitute ? (
            <section className="space-y-3">
              <h2 className="border-l-2 border-navy pl-2 text-sm font-semibold">Institute of Advanced Aesthetics</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Institute leads" value={text(data.instituteLeads)} detail="Created in this range. Not counted as patients." to={leadTo("institute")} />
                <Kpi label="Interested enquiries" value={text(data.interested)} detail="Lead status, not enrolments" to={leadTo("institute", { status: "interested" })} />
                <Kpi label="Active students" value={text(data.activeStudents)} detail={`${text(data.enrolments)} with a course · ${text(data.admissions)} admissions in range`} to="/institute" />
                <Kpi label="Institute collections" value={money(data.collectionsByDesk.find((row) => row.name === "Institute")?.amount ?? (desk === "institute" ? data.collections : null))} detail="Institute payments only" to="/billing" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Action to={leadTo("institute")}>View institute leads</Action>
                <Action to={leadTo("institute")}>Add lead</Action>
                <Action to="/institute">Add student</Action>
                <Action to="/institute">Manage courses</Action>
                <Action to="/institute">Manage admissions</Action>
                <Action to="/institute">View student documents</Action>
                <Action to="/institute">View certificates</Action>
                <Action to="/billing">View institute collections</Action>
                <Action to="/reports">Open institute reports</Action>
              </div>
            </section>
          ) : null}

          {variant === "full" ? (
            <>
              {data.chartNote ? <p className="text-sm text-muted">{data.chartNote}</p> : null}
              <div className="grid gap-4 xl:grid-cols-2">
                <Chart title="Lead acquisition" subtitle={bounds.label} empty={chartsReady && data.trend.length ? "" : "No leads in this range"}>
                  <LineChart data={data.trend}>
                    <CartesianGrid stroke="#eef0f3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="leads" name="Leads" stroke="#1d4ed8" strokeWidth={2} dot={false} />
                  </LineChart>
                </Chart>
                {desk === "all" && chartsReady && data.deskVolume.length ? (
                  <Chart title="Clinic vs institute" subtitle="Lead volume in this range" empty="">
                    <BarChart data={data.deskVolume}>
                      <CartesianGrid stroke="#eef0f3" vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="leads" name="Leads" fill="#12263f" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </Chart>
                ) : null}
                <Chart title="Lead status" subtitle="Status of leads created in this range" empty={chartsReady && data.funnel.length ? "" : "No status data in this range"}>
                  <BarChart data={data.funnel} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid stroke="#eef0f3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={140} tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" name="Leads" fill="#1d4ed8" radius={[0, 4, 4, 0]} barSize={14} />
                  </BarChart>
                </Chart>
                <Chart title="Collections by desk" subtitle="Payments recorded in this range" empty={data.collectionsByDesk.some((row) => row.amount > 0) ? "" : "No payments in this range"}>
                  <BarChart data={data.collectionsByDesk}>
                    <CartesianGrid stroke="#eef0f3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="amount" name="Collected" fill="#12263f" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </Chart>
                <Chart title="Lead sources" subtitle="Where this range's leads came from" empty={chartsReady && data.sources.length ? "" : "No source data in this range"}>
                  <BarChart data={data.sources}>
                    <CartesianGrid stroke="#eef0f3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 11 }} interval={0} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" name="Leads" fill="#8aa0b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </Chart>
                <Chart title="Appointments and admissions" subtitle={bounds.label} empty={data.activity.length ? "" : "No appointments or admissions in this range"}>
                  <LineChart data={data.activity}>
                    <CartesianGrid stroke="#eef0f3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                    <Line type="monotone" dataKey="appointments" name="Appointments" stroke="#1d4ed8" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="admissions" name="Admissions" stroke="#12263f" strokeWidth={2} dot={false} />
                  </LineChart>
                </Chart>
              </div>
              {showInstitute && data.courses.length ? (
                <section className="overflow-x-auto rounded-lg border border-line bg-white">
                  <div className="border-b border-line px-4 py-3">
                    <h3 className="text-sm font-semibold">Course-wise enquiry conversion</h3>
                    <p className="text-xs text-muted">Grouped by the interest recorded on institute leads. An enquiry is not an enrolment.</p>
                  </div>
                  <table className="w-full text-left text-[13px]">
                    <thead className="text-xs text-muted"><tr>{["Interest", "Leads", "Converted"].map((heading) => <th key={heading} className="px-4 py-2 font-medium">{heading}</th>)}</tr></thead>
                    <tbody>
                      {data.courses.map((row) => (
                        <tr key={row.name} className="border-t border-line">
                          <td className="px-4 py-2">{row.name}</td>
                          <td className="px-4 py-2 tabular">{row.leads}</td>
                          <td className="px-4 py-2 tabular">{row.converted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}
              <section className="overflow-x-auto rounded-lg border border-line bg-white">
                <div className="border-b border-line px-4 py-3">
                  <h3 className="text-sm font-semibold">Latest leads</h3>
                  <p className="text-xs text-muted">Newest records in {bounds.label.toLowerCase()}.</p>
                </div>
                {data.recent.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No leads in this range.</p> : (
                  <table className="w-full min-w-[720px] text-left text-[13px]">
                    <thead className="text-xs text-muted"><tr>{["Name", "Desk", "Status", "Source", "Campaign", "Form"].map((heading) => <th key={heading} className="px-4 py-2 font-medium">{heading}</th>)}</tr></thead>
                    <tbody>
                      {data.recent.map((lead) => (
                        <tr key={lead.id} className="border-t border-line">
                          <td className="px-4 py-2 font-medium"><Link to={`/leads/${lead.id}`} className="hover:text-accent">{lead.name}</Link></td>
                          <td className="px-4 py-2">{lead.desk}</td>
                          <td className="px-4 py-2">{lead.status}</td>
                          <td className="px-4 py-2 capitalize">{lead.source || "—"}</td>
                          <td className="px-4 py-2">{lead.campaign || "—"}</td>
                          <td className="px-4 py-2">{lead.form || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
      {clinic || institute ? null : !loading && !error ? <p className="text-sm text-muted">No clinic or institute workspace is available for this account.</p> : null}
    </div>
  );
}

function Chart({ title, subtitle, empty, children }: { title: string; subtitle: string; empty: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted">{subtitle}</p>
      <div className="mt-3 h-[240px]">
        {empty ? <p className="flex h-full items-center justify-center text-center text-sm text-muted">{empty}</p> : (
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

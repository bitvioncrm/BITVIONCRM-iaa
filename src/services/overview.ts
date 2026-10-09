import { rangeBounds } from "@/lib/range";
import { supabase } from "@/lib/supabase";
import { revenueSummary } from "@/services/production-ops";
import type { WorkspaceOption } from "@/services/production-leads";
import type { DeskKey } from "@/context/DeskContext";

const FUNNEL = ["new", "contacted", "interested", "follow_up", "documents_pending", "processing", "interview", "selected", "converted", "lost"] as const;
const FUNNEL_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow-up",
  documents_pending: "Documents",
  processing: "Processing",
  interview: "Appointment / counselling",
  selected: "Selected",
  converted: "Converted",
  lost: "Not interested",
};
const PENDING_APPOINTMENTS = ["scheduled", "confirmed", "arrived", "in_consultation"];

export interface RecentLead {
  id: string;
  name: string;
  status: string;
  source: string;
  form: string;
  campaign: string;
  createdAt: string;
  desk: string;
}

export interface Overview {
  leads: number | null;
  clinicLeads: number | null;
  instituteLeads: number | null;
  newLeads: number | null;
  patients: number | null;
  newPatients: number | null;
  students: number | null;
  newStudents: number | null;
  appointments: number | null;
  admissions: number | null;
  collections: number | null;
  outstanding: number | null;
  followupsPending: number | null;
  followupsOverdue: number | null;
  inventoryAlerts: number | null;
  lowStock: number | null;
  expiring: number | null;
  todayAppointments: number | null;
  pendingAppointments: number | null;
  completedAppointments: number | null;
  interested: number | null;
  counselling: number | null;
  activeStudents: number | null;
  enrolments: number | null;
  trend: Array<{ label: string; leads: number }>;
  deskVolume: Array<{ name: string; leads: number }>;
  funnel: Array<{ name: string; value: number }>;
  sources: Array<{ name: string; value: number }>;
  collectionsByDesk: Array<{ name: string; amount: number }>;
  activity: Array<{ label: string; appointments: number; admissions: number }>;
  courses: Array<{ name: string; leads: number; converted: number }>;
  recent: RecentLead[];
  chartNote: string;
  errors: string[];
}

function db() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

function ids(rows: WorkspaceOption[]) {
  return rows.map((row) => row.id);
}

function ofType(rows: WorkspaceOption[], type: "clinic" | "institute") {
  return rows.filter((row) => row.workspaceType === type);
}

type RowQuery = {
  eq: (column: string, value: string) => RowQuery;
  in: (column: string, values: readonly string[]) => RowQuery;
  gte: (column: string, value: string) => RowQuery;
  lt: (column: string, value: string) => RowQuery;
  lte: (column: string, value: string) => RowQuery;
  is: (column: string, value: null) => RowQuery;
  not: (column: string, operator: string, value: string | null) => RowQuery;
  then: Promise<{ count: number | null; error: { message: string } | null }>["then"];
};

async function countRows(table: string, workspaceIds: string[], apply?: (query: RowQuery) => RowQuery) {
  if (!workspaceIds.length) return 0;
  let query = db().from(table).select("id", { count: "exact", head: true }).in("workspace_id", workspaceIds) as unknown as RowQuery;
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function safe(errors: string[], label: string, run: () => Promise<number>) {
  try {
    return await run();
  } catch (reason) {
    errors.push(reason instanceof Error ? `${label}: ${reason.message}` : `${label} could not be loaded`);
    return null;
  }
}

function labelFor(iso: string, hourly: boolean) {
  const date = new Date(iso);
  if (hourly) return `${String(date.getHours()).padStart(2, "0")}:00`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function sortFor(iso: string, hourly: boolean) {
  const date = new Date(iso);
  return hourly ? date.getHours() : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

async function openOutstanding(workspaceIds: string[]) {
  const { data, error, count } = await db()
    .from("invoices")
    .select("id, total", { count: "exact" })
    .in("workspace_id", workspaceIds)
    .in("status", ["pending", "partial"])
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if ((count ?? 0) > rows.length) throw new Error("Too many open invoices to total in the browser");
  if (!rows.length) return 0;
  const { data: payments, error: paymentError } = await db().from("payments").select("invoice_id, amount").in("invoice_id", rows.map((row) => row.id as string));
  if (paymentError) throw new Error(paymentError.message);
  const paid = new Map<string, number>();
  for (const payment of payments ?? []) {
    const id = payment.invoice_id as string;
    paid.set(id, (paid.get(id) ?? 0) + Number(payment.amount));
  }
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.total) - (paid.get(row.id as string) ?? 0)), 0);
}

async function outstanding(workspaceIds: string[]) {
  if (!workspaceIds.length) return 0;
  let rpc = 0;
  for (const workspaceId of workspaceIds) {
    const { data, error } = await db().rpc("unpaid_total", { ws: workspaceId });
    if (error) return openOutstanding(workspaceIds);
    rpc += Number(data ?? 0);
  }
  return rpc;
}

export async function loadOverview(workspaces: WorkspaceOption[], desk: DeskKey, bounds: { from: string; to: string; fromDate: string; toDate: string }, hourly: boolean): Promise<Overview> {
  const errors: string[] = [];
  const selected = desk === "all" ? workspaces : ofType(workspaces, desk);
  const selectedIds = ids(selected);
  const clinic = ofType(desk === "institute" ? [] : selected, "clinic");
  const institute = ofType(desk === "clinic" ? [] : selected, "institute");
  const clinicIds = ids(clinic);
  const instituteIds = ids(institute);
  const today = rangeBounds("today");
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 30);
  const horizonDate = horizon.toISOString().slice(0, 10);
  const inRange = (query: RowQuery) => query.gte("created_at", bounds.from).lt("created_at", bounds.to);
  const live = (query: RowQuery) => query.is("deleted_at", null);

  const [leads, newLeads, patients, newPatients, students, newStudents, appointments, admissions, followupsPending, followupsOverdue, todayAppointments, pendingAppointments, completedAppointments, interested, counselling, activeStudents, enrolments] = await Promise.all([
    safe(errors, "Leads", () => countRows("leads", selectedIds, (query) => inRange(live(query)))),
    safe(errors, "New leads", () => countRows("leads", selectedIds, (query) => inRange(live(query)).eq("status", "new"))),
    safe(errors, "Patients", () => countRows("patients", clinicIds, live)),
    safe(errors, "New patients", () => countRows("patients", clinicIds, (query) => inRange(live(query)))),
    safe(errors, "Students", () => countRows("students", instituteIds, live)),
    safe(errors, "New students", () => countRows("students", instituteIds, (query) => inRange(live(query)))),
    safe(errors, "Appointments", () => countRows("appointments", clinicIds, (query) => query.gte("starts_at", bounds.from).lt("starts_at", bounds.to))),
    safe(errors, "Admissions", () => countRows("admissions", instituteIds, (query) => query.gte("admitted_on", bounds.fromDate).lte("admitted_on", bounds.toDate))),
    safe(errors, "Follow-ups", () => countRows("followups", selectedIds, (query) => query.eq("status", "pending").gte("due_at", new Date().toISOString()))),
    safe(errors, "Overdue follow-ups", () => countRows("followups", selectedIds, (query) => query.eq("status", "pending").lt("due_at", new Date().toISOString()))),
    safe(errors, "Today's appointments", () => countRows("appointments", clinicIds, (query) => query.gte("starts_at", today.from).lt("starts_at", today.to))),
    safe(errors, "Pending appointments", () => countRows("appointments", clinicIds, (query) => query.gte("starts_at", bounds.from).lt("starts_at", bounds.to).in("status", PENDING_APPOINTMENTS))),
    safe(errors, "Completed appointments", () => countRows("appointments", clinicIds, (query) => query.gte("starts_at", bounds.from).lt("starts_at", bounds.to).eq("status", "completed"))),
    safe(errors, "Interested enquiries", () => countRows("leads", instituteIds, (query) => inRange(live(query)).eq("status", "interested"))),
    safe(errors, "Counselling", () => countRows("appointments", instituteIds, (query) => query.gte("starts_at", bounds.from).lt("starts_at", bounds.to))),
    safe(errors, "Active students", () => countRows("students", instituteIds, (query) => live(query).not("status", "in", "(completed,withdrawn,cancelled)"))),
    safe(errors, "Enrolments", () => countRows("students", instituteIds, (query) => live(query).not("course_id", "is", null))),
  ]);

  let collections: number | null = 0;
  const collectionsByDesk = [
    { name: "Clinic", amount: 0 },
    { name: "Institute", amount: 0 },
  ];
  try {
    const money = await Promise.all(selected.map(async (workspace) => ({ workspace, money: await revenueSummary(workspace.id, bounds.fromDate, bounds.toDate) })));
    for (const row of money) {
      const target = row.workspace.workspaceType === "institute" ? collectionsByDesk[1] : collectionsByDesk[0];
      if (target) target.amount += row.money.collected;
    }
    collections = collectionsByDesk.reduce((sum, row) => sum + row.amount, 0);
  } catch (reason) {
    collections = null;
    errors.push(reason instanceof Error ? `Collections: ${reason.message}` : "Collections could not be loaded");
  }

  const clinicLeads = desk === "clinic" ? leads : await safe(errors, "Clinic leads", () => countRows("leads", clinicIds, (query) => inRange(live(query))));
  const instituteLeads = desk === "institute" ? leads : await safe(errors, "Institute leads", () => countRows("leads", instituteIds, (query) => inRange(live(query))));
  const outstandingTotal = await safe(errors, "Outstanding", () => outstanding(selectedIds));

  let lowStock: number | null = 0;
  let expiring: number | null = 0;
  let inventoryAlerts: number | null = 0;
  try {
    if (!clinicIds.length) {
      lowStock = 0;
      expiring = 0;
      inventoryAlerts = 0;
    } else {
      const { data, error, count } = await db().from("inventory_products").select("id, current_stock, minimum_stock, expires_on", { count: "exact" }).in("workspace_id", clinicIds).limit(500);
      if (error) throw new Error(error.message);
      if ((count ?? 0) > (data ?? []).length) throw new Error("Product list is larger than this screen can total");
      const low = (data ?? []).filter((row) => Number(row.current_stock) <= Number(row.minimum_stock));
      const exp = (data ?? []).filter((row) => row.expires_on && String(row.expires_on) <= horizonDate && Number(row.current_stock) > 0);
      lowStock = low.length;
      expiring = exp.length;
      inventoryAlerts = new Set([...low, ...exp].map((row) => row.id as string)).size;
    }
  } catch (reason) {
    lowStock = null;
    expiring = null;
    inventoryAlerts = null;
    errors.push(reason instanceof Error ? `Inventory: ${reason.message}` : "Inventory could not be loaded");
  }

  let trend: Overview["trend"] = [];
  let funnel: Overview["funnel"] = [];
  let sources: Overview["sources"] = [];
  let courses: Overview["courses"] = [];
  let recent: RecentLead[] = [];
  let chartNote = "";
  let deskVolume: Overview["deskVolume"] = [];
  const deskName = new Map(workspaces.map((workspace) => [workspace.id, workspace.workspaceType === "institute" ? "Institute" : "Clinic"]));
  try {
    if (selectedIds.length && leads !== null) {
      const { data, error } = await db()
        .from("leads")
        .select("id, full_name, status, source, source_form, source_campaign, created_at, workspace_id, position")
        .in("workspace_id", selectedIds)
        .is("deleted_at", null)
        .gte("created_at", bounds.from)
        .lt("created_at", bounds.to)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (leads > rows.length) {
        chartNote = "Charts are hidden because this range has more leads than can be charted without a partial picture. The KPI counts above are exact.";
      } else {
        const ordered = [...rows].reverse();
        const trendMap = new Map<string, { label: string; leads: number; sort: number }>();
        const sourceMap = new Map<string, number>();
        const statusMap = new Map<string, number>();
        const volumeMap = new Map<string, number>();
        const courseMap = new Map<string, { leads: number; converted: number }>();
        for (const row of ordered) {
          const at = String(row.created_at);
          const key = labelFor(at, hourly);
          const point = trendMap.get(key) ?? { label: key, leads: 0, sort: sortFor(at, hourly) };
          point.leads += 1;
          trendMap.set(key, point);
          const source = String(row.source || "other");
          sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
          const status = String(row.status);
          statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
          const deskLabel = deskName.get(String(row.workspace_id)) ?? "Clinic";
          volumeMap.set(deskLabel, (volumeMap.get(deskLabel) ?? 0) + 1);
          if (instituteIds.includes(String(row.workspace_id))) {
            const name = String(row.position || "Unspecified");
            const course = courseMap.get(name) ?? { leads: 0, converted: 0 };
            course.leads += 1;
            if (row.status === "converted") course.converted += 1;
            courseMap.set(name, course);
          }
        }
        trend = [...trendMap.values()].sort((a, b) => a.sort - b.sort).map(({ label, leads: count }) => ({ label, leads: count }));
        sources = [...sourceMap.entries()].map(([name, value]) => ({ name: name.replace(/_/g, " "), value })).sort((a, b) => b.value - a.value);
        funnel = FUNNEL.filter((status) => statusMap.has(status)).map((status) => ({ name: FUNNEL_LABEL[status] ?? status, value: statusMap.get(status) ?? 0 }));
        deskVolume = ["Clinic", "Institute"].filter((name) => volumeMap.has(name)).map((name) => ({ name, leads: volumeMap.get(name) ?? 0 }));
        courses = [...courseMap.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.leads - a.leads).slice(0, 8);
      }
      recent = rows.slice(0, 8).map((row) => ({
        id: String(row.id),
        name: String(row.full_name),
        status: FUNNEL_LABEL[String(row.status)] ?? String(row.status),
        source: String(row.source || "").replace(/_/g, " "),
        form: String(row.source_form || ""),
        campaign: String(row.source_campaign || ""),
        createdAt: String(row.created_at),
        desk: deskName.get(String(row.workspace_id)) ?? "",
      }));
    }
  } catch (reason) {
    chartNote = reason instanceof Error ? reason.message : "Charts could not be loaded";
    errors.push(chartNote);
  }

  let activity: Overview["activity"] = [];
  try {
    const [appointmentRows, admissionRows] = await Promise.all([
      clinicIds.length
        ? db().from("appointments").select("starts_at").in("workspace_id", clinicIds).gte("starts_at", bounds.from).lt("starts_at", bounds.to).limit(2000)
        : Promise.resolve({ data: [], error: null }),
      instituteIds.length
        ? db().from("admissions").select("admitted_on").in("workspace_id", instituteIds).gte("admitted_on", bounds.fromDate).lte("admitted_on", bounds.toDate).limit(2000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (appointmentRows.error) throw new Error(appointmentRows.error.message);
    if (admissionRows.error) throw new Error(admissionRows.error.message);
    const map = new Map<string, { label: string; appointments: number; admissions: number; sort: number }>();
    for (const row of appointmentRows.data ?? []) {
      const at = String(row.starts_at);
      const key = labelFor(at, hourly);
      const point = map.get(key) ?? { label: key, appointments: 0, admissions: 0, sort: sortFor(at, hourly) };
      point.appointments += 1;
      map.set(key, point);
    }
    for (const row of admissionRows.data ?? []) {
      const at = `${row.admitted_on}T00:00:00`;
      const key = labelFor(at, false);
      const point = map.get(key) ?? { label: key, appointments: 0, admissions: 0, sort: sortFor(at, false) };
      point.admissions += 1;
      map.set(key, point);
    }
    activity = [...map.values()].sort((a, b) => a.sort - b.sort).map(({ label, appointments: appointmentCount, admissions: admissionCount }) => ({
      label,
      appointments: appointmentCount,
      admissions: admissionCount,
    }));
  } catch (reason) {
    errors.push(reason instanceof Error ? `Activity trend: ${reason.message}` : "Activity trend could not be loaded");
  }

  return {
    leads,
    clinicLeads,
    instituteLeads,
    newLeads,
    patients,
    newPatients,
    students,
    newStudents,
    appointments,
    admissions,
    collections,
    outstanding: outstandingTotal,
    followupsPending,
    followupsOverdue,
    inventoryAlerts,
    lowStock,
    expiring,
    todayAppointments,
    pendingAppointments,
    completedAppointments,
    interested,
    counselling,
    activeStudents,
    enrolments,
    trend,
    deskVolume,
    funnel,
    sources,
    collectionsByDesk: collections === null ? [] : collectionsByDesk.filter((row) => desk === "all" || row.name.toLowerCase() === desk),
    activity,
    courses,
    recent,
    chartNote,
    errors,
  };
}

export async function loadLiveAlerts(workspaces: WorkspaceOption[]) {
  const alerts: Array<{ title: string; body: string; href: string }> = [];
  const clinicIds = ids(ofType(workspaces, "clinic"));
  const all = ids(workspaces);
  if (!all.length || !supabase) return alerts;
  const unassigned = await countRows("leads", all, (query) => query.is("deleted_at", null).is("assigned_to", null).eq("status", "new")).catch(() => null);
  if (unassigned) alerts.push({ title: "Unassigned leads", body: `${unassigned} new leads have no counsellor`, href: "/leads?status=new&assigned=unassigned" });
  const overdue = await countRows("followups", all, (query) => query.eq("status", "pending").lt("due_at", new Date().toISOString())).catch(() => null);
  if (overdue) alerts.push({ title: "Overdue follow-ups", body: `${overdue} follow-ups are past due`, href: "/follow-ups" });
  if (clinicIds.length) {
    const products = await db().from("inventory_products").select("id, name, current_stock, minimum_stock, expires_on").in("workspace_id", clinicIds).limit(100);
    const low = (products.data ?? []).filter((row) => Number(row.current_stock) <= Number(row.minimum_stock));
    if (low.length) alerts.push({ title: "Low stock", body: `${low.length} products are at or below minimum`, href: "/inventory" });
  }
  const organizationId = workspaces[0]?.organizationId;
  if (organizationId) {
    const status = await db().from("integration_status").select("provider, status, detail").eq("organization_id", organizationId);
    for (const row of status.data ?? []) {
      if (row.status === "error") alerts.push({ title: `${row.provider} needs attention`, body: String(row.detail || "Integration reported an error"), href: row.provider === "meta" ? "/meta" : "/settings" });
      if (row.provider === "meta" && row.status === "configuration_required") alerts.push({ title: "Meta setup required", body: "Meta integration is not configured.", href: "/meta" });
    }
    const failed = await db().from("meta_import_events").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["failed", "unmapped"]);
    if ((failed.count ?? 0) > 0) alerts.push({ title: "Meta imports need review", body: `${failed.count} failed or unmapped imports`, href: "/meta" });
  }
  return alerts.slice(0, 8);
}

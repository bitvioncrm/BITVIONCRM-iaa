import { elapsedSeconds, emptyCallTotals, formatClock, outcomeFromPhoneReturn, remainingSeconds, sumCompleted, summarizeCalls, type CallOutcome, type CallTotals } from "@/lib/call-time";
import { phoneKey } from "@/lib/lead-normalize";
import { balance, invoiceTotal } from "@/lib/money";
import { isAllowedDocument, optimizeDocument, optimizeImage, sha256 } from "@/lib/files";

export const STUDENT_DOCUMENT_TYPES = [
  { value: "aadhaar", label: "Aadhaar card" },
  { value: "pan", label: "PAN card" },
  { value: "passport", label: "Passport" },
  { value: "other_id", label: "Other government ID" },
  { value: "academic", label: "Academic" },
  { value: "other", label: "Other" },
] as const;

export function documentTypeLabel(category: string) {
  return STUDENT_DOCUMENT_TYPES.find((item) => item.value === category)?.label || category || "Document";
}
import { supabase } from "@/lib/supabase";

function client() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

const deskCache = new Map<string, { at: number; value: unknown }>();
const DESK_FRESH_MS = 20000;

function readDesk<T>(key: string) {
  const hit = deskCache.get(key);
  if (!hit || Date.now() - hit.at > DESK_FRESH_MS) return null;
  return hit.value as T;
}

function writeDesk(key: string, value: unknown) {
  deskCache.set(key, { at: Date.now(), value });
}

function forgetDeskLists() {
  deskCache.clear();
}

export function clearDeskCache() {
  deskCache.clear();
}

async function userId() {
  const { data, error } = await client().auth.getUser();
  if (error || !data.user) throw new Error(error?.message ?? "Configuration Required");
  return data.user.id;
}

export async function completeFollowUp(id: string) {
  const { error } = await client().from("followups").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeFollowUp(id: string) {
  const { error } = await client().from("followups").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listFollowUps(workspaceId: string) {
  const { data, error } = await client().from("followups").select("id, lead_id, due_at, status, notes, leads(full_name)").eq("workspace_id", workspaceId).order("due_at").limit(80);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const lead = row.leads as { full_name?: string } | { full_name?: string }[] | null;
    const named = Array.isArray(lead) ? lead[0] : lead;
    return {
      id: String(row.id),
      lead_id: String(row.lead_id || ""),
      due_at: String(row.due_at || ""),
      status: String(row.status || ""),
      notes: String(row.notes || ""),
      lead_name: named?.full_name || "Lead",
    };
  });
}

export async function listTasks(workspaceId: string) {
  const { data, error } = await client().from("tasks").select("id, title, status, priority, due_at, assigned_to").eq("workspace_id", workspaceId).is("deleted_at", null).order("due_at").limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updateTask(id: string, patch: { title?: string; status?: string }) {
  const { error } = await client().from("tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function removeTask(id: string) {
  const { error } = await client().from("tasks").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function createTask(input: { organizationId: string; workspaceId: string; title: string; dueAt: string; assignedTo: string }) {
  const { error } = await client().from("tasks").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    title: input.title,
    due_at: input.dueAt,
    assigned_to: input.assignedTo,
    created_by: await userId(),
  });
  if (error) throw new Error(error.message);
}

export type { CallOutcome, CallTotals };
export { emptyCallTotals, formatClock };

export interface LiveCall {
  id: string;
  leadId: string;
  workspaceId: string;
  startedAt: string;
  name: string;
}

export async function startCall(organizationId: string, workspaceId: string, leadId: string | null, partyName = "") {
  const uid = await userId();
  const { data: active, error: activeError } = await client().from("call_time_sessions").select("id, started_at").eq("user_id", uid).eq("status", "active");
  if (activeError) throw new Error(activeError.message);
  const ended = new Date().toISOString();
  for (const row of active ?? []) {
    const elapsed = elapsedSeconds(String(row.started_at), ended) ?? 0;
    await endCall(String(row.id), outcomeFromPhoneReturn(elapsed), ended);
  }
  const { data, error } = await client().from("call_time_sessions").insert({
    organization_id: organizationId,
    workspace_id: workspaceId,
    user_id: uid,
    lead_id: leadId || null,
    party_name: partyName.trim(),
    status: "active",
  }).select("id, started_at, lead_id, workspace_id, party_name").single();
  if (error) throw new Error(error.message);
  return {
    id: data.id as string,
    startedAt: data.started_at as string,
    leadId: String(data.lead_id || ""),
    workspaceId: data.workspace_id as string,
    name: String(data.party_name || ""),
  } satisfies LiveCall;
}

export async function endCall(sessionId: string, outcome: CallOutcome, endedAt = new Date().toISOString()) {
  const { data, error } = await client().from("call_time_sessions").select("started_at, status").eq("id", sessionId).single();
  if (error) throw new Error(error.message);
  if (data.status !== "active") throw new Error("This timing session is not active.");
  const elapsed = elapsedSeconds(data.started_at as string, endedAt);
  if (elapsed === null) throw new Error("The timer could not be calculated. It was not added to call time.");
  const duration = elapsed;
  const { error: updateError } = await client().from("call_time_sessions").update({
    status: "completed",
    outcome,
    ended_at: endedAt,
    duration_seconds: duration,
  }).eq("id", sessionId).eq("status", "active");
  if (updateError) throw new Error(updateError.message);
  return duration;
}

export async function activeCall() {
  const uid = await userId();
  const { data, error } = await client()
    .from("call_time_sessions")
    .select("id, lead_id, workspace_id, started_at, party_name, leads(full_name)")
    .eq("user_id", uid)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const lead = data.leads as { full_name?: string } | { full_name?: string }[] | null;
  const leadName = Array.isArray(lead) ? lead[0]?.full_name : lead?.full_name;
  return {
    id: data.id as string,
    leadId: String(data.lead_id || ""),
    workspaceId: data.workspace_id as string,
    startedAt: data.started_at as string,
    name: leadName || String(data.party_name || ""),
  } satisfies LiveCall;
}

export async function leadCallStats(leadIds: string[]) {
  const unique = [...new Set(leadIds.filter(Boolean))];
  const grouped: Record<string, CallTotals> = {};
  for (const id of unique) grouped[id] = emptyCallTotals();
  if (!unique.length) return grouped;
  const { data, error } = await client()
    .from("call_time_sessions")
    .select("lead_id, status, outcome, duration_seconds")
    .in("lead_id", unique)
    .eq("status", "completed");
  if (error) throw new Error(error.message);
  const buckets = new Map<string, Array<{ status: string; outcome: string | null; duration_seconds: number | null }>>();
  for (const row of data ?? []) {
    const leadId = row.lead_id as string | null;
    if (!leadId) continue;
    const list = buckets.get(leadId) ?? [];
    list.push({ status: row.status as string, outcome: row.outcome as string | null, duration_seconds: row.duration_seconds as number | null });
    buckets.set(leadId, list);
  }
  for (const [leadId, rows] of buckets) grouped[leadId] = summarizeCalls(rows);
  return grouped;
}

export async function callDeskReport(workspaceId: string, everyone: boolean) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  let request = client()
    .from("call_time_sessions")
    .select("status, outcome, duration_seconds, started_at, ended_at, lead_id, party_name, leads(full_name)")
    .eq("workspace_id", workspaceId)
    .gte("started_at", start.toISOString())
    .order("started_at", { ascending: false })
    .limit(200);
  if (!everyone) request = request.eq("user_id", await userId());
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const totals = summarizeCalls(rows.map((row) => ({
    status: row.status as string,
    outcome: row.outcome as string | null,
    duration_seconds: row.duration_seconds as number | null,
  })));
  const calls = rows
    .filter((row) => row.status === "completed" && row.outcome)
    .map((row) => {
      const lead = row.leads as { full_name?: string } | { full_name?: string }[] | null;
      const name = Array.isArray(lead) ? lead[0]?.full_name : lead?.full_name;
      return {
        leadId: (row.lead_id as string | null) ?? "",
        leadName: name || String(row.party_name || "") || "Call",
        outcome: row.outcome as CallOutcome,
        talkSeconds: Number(row.duration_seconds ?? 0),
        startedAt: row.started_at as string,
        endedAt: String(row.ended_at || ""),
      };
    });
  return { ...totals, calls };
}

export async function callSummary(workspaceId: string) {
  const uid = await userId();
  const since = new Date();
  since.setDate(since.getDate() - 31);
  const { data, error } = await client().from("call_time_sessions").select("started_at, duration_seconds, status").eq("workspace_id", workspaceId).eq("user_id", uid).gte("started_at", since.toISOString());
  if (error) throw new Error(error.message);
  const { data: targetRow } = await client().from("call_time_targets").select("target_seconds").eq("workspace_id", workspaceId).eq("user_id", uid).maybeSingle();
  const target = (targetRow?.target_seconds as number | undefined) ?? 150 * 60;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfDay - ((now.getDay() + 6) % 7) * 86400000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const completed = (data ?? []).filter((row) => row.status === "completed");
  const inRange = (from: number) => sumCompleted(completed.filter((row) => new Date(row.started_at as string).getTime() >= from).map((row) => row.duration_seconds as number));
  const today = inRange(startOfDay);
  return { today, week: inRange(startOfWeek), month: inRange(startOfMonth), target, remaining: remainingSeconds(target, today), active: (data ?? []).some((row) => row.status === "active") };
}

export interface DeskAppointment {
  id: string;
  starts_at: string;
  status: string;
  reason: string;
  doctor_id: string;
}

export interface DeskTreatment {
  id: string;
  performed_on: string;
  title: string;
}

export interface DeskPatient {
  id: string;
  patient_code: string;
  full_name: string;
  mobile: string;
  email: string;
  gender: string;
  date_of_birth: string | null;
  age: number | null;
  place: string;
  address: string;
  emergency_contact: string;
  notes: string;
  created_at: string;
  photo_path: string;
  appointments: DeskAppointment[];
  treatments: DeskTreatment[];
}

export interface DeskMoney {
  id: string;
  kind: "income" | "expense";
  amount: number;
  note: string;
  at: string;
  patientId: string;
  source: "ledger" | "payment" | "refund";
}

export async function listDeskPatients(workspaceId: string) {
  const key = `patients:v4:${workspaceId}`;
  const cached = readDesk<DeskPatient[]>(key);
  if (cached) return cached;
  const [patients, appointments, treatments, consultations] = await Promise.all([
    client().from("patients").select("id, patient_code, full_name, mobile, email, gender, date_of_birth, age, place, address, emergency_contact, notes, created_at, photo_path").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(500),
    client().from("appointments").select("id, patient_id, doctor_id, starts_at, status, reason").eq("workspace_id", workspaceId).not("status", "in", "(cancelled)").order("starts_at", { ascending: false }).limit(1000),
    client().from("patient_procedures").select("id, patient_id, performed_on, procedure_1, procedure_2").eq("workspace_id", workspaceId).order("performed_on", { ascending: true }).limit(1000),
    client().from("consultations").select("id, patient_id, diagnosis, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }).limit(1000),
  ]);
  if (patients.error) throw new Error(patients.error.message);
  if (appointments.error) throw new Error(appointments.error.message);
  if (treatments.error) throw new Error(treatments.error.message);
  if (consultations.error) throw new Error(consultations.error.message);
  const byPatient = new Map<string, DeskAppointment[]>();
  for (const row of appointments.data ?? []) {
    const patientId = String(row.patient_id);
    const list = byPatient.get(patientId) ?? [];
    list.push({ id: String(row.id), starts_at: String(row.starts_at), status: String(row.status), reason: String(row.reason || ""), doctor_id: String(row.doctor_id || "") });
    byPatient.set(patientId, list);
  }
  const treatmentsByPatient = new Map<string, DeskTreatment[]>();
  for (const row of treatments.data ?? []) {
    const patientId = String(row.patient_id);
    const list = treatmentsByPatient.get(patientId) ?? [];
    const title = [row.procedure_1, row.procedure_2].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
    list.push({ id: String(row.id), performed_on: String(row.performed_on || ""), title: title || "Treatment" });
    treatmentsByPatient.set(patientId, list);
  }
  for (const row of consultations.data ?? []) {
    const patientId = String(row.patient_id);
    const list = treatmentsByPatient.get(patientId) ?? [];
    list.push({ id: String(row.id), performed_on: String(row.created_at || ""), title: String(row.diagnosis || "Consultation") });
    treatmentsByPatient.set(patientId, list);
  }
  const rows = (patients.data ?? []).map((row) => ({
    id: String(row.id),
    patient_code: String(row.patient_code || ""),
    full_name: String(row.full_name || ""),
    mobile: String(row.mobile || ""),
    email: String(row.email || ""),
    gender: String(row.gender || ""),
    date_of_birth: row.date_of_birth ? String(row.date_of_birth) : null,
    age: row.age == null ? null : Number(row.age),
    place: String(row.place || ""),
    address: String(row.address || ""),
    emergency_contact: String(row.emergency_contact || ""),
    notes: String(row.notes || ""),
    created_at: String(row.created_at),
    photo_path: String(row.photo_path || ""),
    appointments: byPatient.get(String(row.id)) ?? [],
    treatments: treatmentsByPatient.get(String(row.id)) ?? [],
  })) satisfies DeskPatient[];
  writeDesk(key, rows);
  return rows;
}

export async function listDeskMoney(workspaceId: string) {
  const [ledger, payments, refunds] = await Promise.all([
    client().from("clinic_ledger").select("id, patient_id, kind, amount, note, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    client().from("payments").select("id, amount, method, paid_on, invoices(patient_id)").eq("workspace_id", workspaceId).order("paid_on", { ascending: false }).limit(500),
    client().from("refunds").select("id, amount, created_at, invoices(patient_id)").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
  ]);
  if (ledger.error) throw new Error(ledger.error.message);
  if (payments.error) throw new Error(payments.error.message);
  if (refunds.error) throw new Error(refunds.error.message);
  const income: DeskMoney[] = (ledger.data ?? []).map((row) => ({
    id: String(row.id),
    kind: row.kind === "expense" ? "expense" : "income",
    amount: Number(row.amount ?? 0),
    note: String(row.note || ""),
    at: String(row.created_at || ""),
    patientId: String(row.patient_id || ""),
    source: "ledger" as const,
  }));
  const collected: DeskMoney[] = (payments.data ?? []).map((row) => {
    const invoice = row.invoices as { patient_id?: string } | { patient_id?: string }[] | null;
    const patientId = (Array.isArray(invoice) ? invoice[0]?.patient_id : invoice?.patient_id) || "";
    return {
      id: String(row.id),
      kind: "income" as const,
      amount: Number(row.amount ?? 0),
      note: String(row.method || "Payment"),
      at: String(row.paid_on || ""),
      patientId: String(patientId),
      source: "payment" as const,
    };
  });
  const returned: DeskMoney[] = (refunds.data ?? []).map((row) => {
    const invoice = row.invoices as { patient_id?: string } | { patient_id?: string }[] | null;
    const patientId = (Array.isArray(invoice) ? invoice[0]?.patient_id : invoice?.patient_id) || "";
    return {
      id: String(row.id),
      kind: "expense" as const,
      amount: Number(row.amount ?? 0),
      note: "Refund",
      at: String(row.created_at || ""),
      patientId: String(patientId),
      source: "refund" as const,
    };
  });
  return [...income, ...collected, ...returned];
}

export async function removeDeskMoney(row: Pick<DeskMoney, "id" | "source">) {
  forgetDeskLists();
  if (row.source === "ledger") {
    const { error } = await client().from("clinic_ledger").delete().eq("id", row.id);
    if (error) throw new Error(error.message);
    return;
  }
  if (row.source === "payment") {
    const { data, error } = await client().from("payments").delete().eq("id", row.id).select("invoice_id").maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.invoice_id) await syncInvoiceTotals(String(data.invoice_id));
    return;
  }
  const { data, error } = await client().from("refunds").delete().eq("id", row.id).select("invoice_id").maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.invoice_id) {
    const { error: statusError } = await client().from("invoices").update({ status: "partial", updated_at: new Date().toISOString() }).eq("id", data.invoice_id).eq("status", "refunded");
    if (statusError) throw new Error(statusError.message);
    await syncInvoiceTotals(String(data.invoice_id));
  }
}

export interface PatientProductLine {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  amount: number;
}

export interface PatientPrescription {
  id: string;
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface PatientTreatment {
  id: string;
  kind: "procedure" | "consultation";
  when: string;
  doctorId: string;
  title: string;
  detail: string;
  notes: string;
  procedure1: string;
  procedure2: string;
  diagnosis: string;
  plan: string;
  followUpOn: string;
  prescriptions: PatientPrescription[];
  products: PatientProductLine[];
}

export interface PatientBill {
  id: string;
  number: string;
  issuedOn: string;
  status: string;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  items: Array<{ id: string; description: string; quantity: number; unitPrice: number; amount: number }>;
}

export interface PatientRecord {
  treatments: PatientTreatment[];
  bills: PatientBill[];
}

function named(value: unknown) {
  const row = value as { name?: string } | { name?: string }[] | null;
  return (Array.isArray(row) ? row[0]?.name : row?.name) || "";
}

export async function loadPatientRecord(patientId: string): Promise<PatientRecord> {
  const [procedures, consultations, invoices] = await Promise.all([
    client().from("patient_procedures").select("id, doctor_id, procedure_1, procedure_2, performed_on, notes, patient_procedure_items(id, product_id, quantity, line_total, inventory_products(name))").eq("patient_id", patientId).order("performed_on", { ascending: false }).limit(80),
    client().from("consultations").select("id, doctor_id, diagnosis, treatment_plan, follow_up_on, created_at, prescriptions(id, medicine, dosage, frequency, duration, instructions)").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(80),
    client().from("invoices").select("id, invoice_number, status, discount, total, issued_on, invoice_items(id, description, quantity, unit_price), payments(amount)").eq("patient_id", patientId).order("issued_on", { ascending: false }).limit(40),
  ]);
  if (procedures.error) throw new Error(procedures.error.message);
  if (consultations.error) throw new Error(consultations.error.message);
  if (invoices.error) throw new Error(invoices.error.message);
  const fromProcedures: PatientTreatment[] = (procedures.data ?? []).map((row) => {
    const items = (row.patient_procedure_items as Array<Record<string, unknown>> | null) ?? [];
    const products = items.map((item) => ({
      id: String(item.id || ""),
      productId: String(item.product_id || ""),
      name: named(item.inventory_products) || "Product",
      quantity: Number(item.quantity ?? 0),
      amount: Number(item.line_total ?? 0),
    }));
    const title = [row.procedure_1, row.procedure_2].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
    return {
      id: String(row.id),
      kind: "procedure" as const,
      when: String(row.performed_on || ""),
      doctorId: String(row.doctor_id || ""),
      title: title || "Treatment",
      detail: "",
      notes: String(row.notes || ""),
      procedure1: String(row.procedure_1 || ""),
      procedure2: String(row.procedure_2 || ""),
      diagnosis: "",
      plan: "",
      followUpOn: "",
      prescriptions: [],
      products,
    };
  });
  const fromVisits: PatientTreatment[] = (consultations.data ?? []).map((row) => {
    const medicines = (row.prescriptions as Array<Record<string, unknown>> | null) ?? [];
    const prescriptions = medicines.map((item) => ({
      id: String(item.id || ""),
      medicine: String(item.medicine || ""),
      dosage: String(item.dosage || ""),
      frequency: String(item.frequency || ""),
      duration: String(item.duration || ""),
      instructions: String(item.instructions || ""),
    }));
    const detail = prescriptions.map((item) => [item.medicine, item.dosage, item.frequency, item.duration ? `for ${item.duration}` : ""].filter(Boolean).join(" · ")).filter(Boolean).join("; ");
    const plan = String(row.treatment_plan || "").trim();
    const follow = row.follow_up_on ? `Follow-up ${String(row.follow_up_on)}` : "";
    return {
      id: String(row.id),
      kind: "consultation" as const,
      when: String(row.created_at || ""),
      doctorId: String(row.doctor_id || ""),
      title: String(row.diagnosis || "").trim() || "Consultation",
      detail: [plan, detail, follow].filter(Boolean).join("\n"),
      notes: "",
      procedure1: "",
      procedure2: "",
      diagnosis: String(row.diagnosis || ""),
      plan,
      followUpOn: String(row.follow_up_on || ""),
      prescriptions,
      products: [],
    };
  });
  const bills: PatientBill[] = (invoices.data ?? []).map((row) => {
    const items = ((row.invoice_items as Array<Record<string, unknown>> | null) ?? []).map((item) => {
      const quantity = Number(item.quantity ?? 1);
      const unitPrice = Number(item.unit_price ?? 0);
      return {
        id: String(item.id || ""),
        description: String(item.description || "Item"),
        quantity,
        unitPrice,
        amount: quantity * unitPrice,
      };
    });
    const paid = ((row.payments as Array<{ amount?: number }> | null) ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const total = Number(row.total ?? 0);
    return {
      id: String(row.id),
      number: String(row.invoice_number || ""),
      issuedOn: String(row.issued_on || ""),
      status: String(row.status || ""),
      discount: Number(row.discount ?? 0),
      total,
      paid,
      balance: Math.max(0, total - paid),
      items,
    };
  });
  return {
    treatments: [...fromProcedures, ...fromVisits].sort((left, right) => right.when.localeCompare(left.when)),
    bills,
  };
}

export interface DeskStudent {
  id: string;
  student_code: string;
  full_name: string;
  mobile: string;
  email: string;
  gender: string;
  date_of_birth: string | null;
  address: string;
  status: string;
  admission_date: string | null;
  created_at: string;
  course: string;
  batch: string;
  photo_path: string;
  lead_id: string;
}

export async function listDeskStudents(workspaceId: string) {
  const key = `students:v2:${workspaceId}`;
  const cached = readDesk<DeskStudent[]>(key);
  if (cached) return cached;
  const { data, error } = await client()
    .from("students")
    .select("id, student_code, full_name, mobile, email, gender, date_of_birth, address, status, admission_date, created_at, photo_path, lead_id, courses(name), batches(name)")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row) => {
    const course = row.courses as { name?: string } | { name?: string }[] | null;
    const batch = row.batches as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(course) ? course[0]?.name : course?.name;
    const batchName = Array.isArray(batch) ? batch[0]?.name : batch?.name;
    return {
      id: String(row.id),
      student_code: String(row.student_code || ""),
      full_name: String(row.full_name || ""),
      mobile: String(row.mobile || ""),
      email: String(row.email || ""),
      gender: String(row.gender || ""),
      date_of_birth: row.date_of_birth ? String(row.date_of_birth) : null,
      address: String(row.address || ""),
      status: String(row.status || ""),
      admission_date: row.admission_date ? String(row.admission_date) : null,
      created_at: String(row.created_at),
      course: name || "",
      batch: batchName || "",
      photo_path: String(row.photo_path || ""),
      lead_id: String(row.lead_id || ""),
    } satisfies DeskStudent;
  });
  writeDesk(key, rows);
  return rows;
}

export async function listPatients(workspaceId: string, search: string) {
  let request = client().from("patients").select("id, patient_code, full_name, mobile, place, photo_path").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30);
  if (search.trim()) request = request.ilike("full_name", `%${search.trim().replace(/[%_]/g, "")}%`);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function serverCode(fn: "next_patient_code" | "next_student_code", fallback: string) {
  const { data, error } = await client().rpc(fn);
  if (!error && typeof data === "string" && data) return data;
  return fallback;
}

export async function createPatient(input: { organizationId: string; workspaceId: string; fullName: string; mobile: string; place: string; email?: string; gender?: string; dateOfBirth?: string | null; address?: string; emergencyContact?: string; notes?: string; leadId?: string | null }) {
  forgetDeskLists();
  const mobile = input.mobile.trim();
  const key = phoneKey(mobile);
  if (key.length >= 10) {
    const existing = await client()
      .from("patients")
      .select("id, patient_code, mobile")
      .eq("workspace_id", input.workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(500);
    if (existing.error) throw new Error(existing.error.message);
    const match = (existing.data ?? []).find((row) => phoneKey(String(row.mobile || "")) === key);
    if (match) {
      await updatePatient(String(match.id), {
        fullName: input.fullName,
        mobile,
        place: input.place,
        email: input.email,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth,
        address: input.address,
        emergencyContact: input.emergencyContact,
        notes: input.notes,
      });
      if (input.leadId) {
        await client().from("patients").update({ lead_id: input.leadId, updated_at: new Date().toISOString() }).eq("id", match.id).is("deleted_at", null);
      }
      return String(match.patient_code || "");
    }
  }
  const code = await serverCode("next_patient_code", `DKC-P-${Date.now().toString(36).toUpperCase()}`);
  const dob = input.dateOfBirth || null;
  const age = dob ? Math.max(0, new Date().getFullYear() - new Date(dob).getFullYear()) : null;
  const { error } = await client().from("patients").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId || null,
    patient_code: code,
    full_name: input.fullName.trim(),
    mobile,
    email: input.email ?? "",
    gender: input.gender ?? "other",
    date_of_birth: dob,
    age,
    place: input.place.trim(),
    address: input.address ?? "",
    emergency_contact: input.emergencyContact ?? "",
    notes: input.notes ?? "",
    created_by: await userId(),
  });
  if (error) throw new Error(error.message);
  await client().from("audit_logs").insert({ user_id: await userId(), organization_id: input.organizationId, workspace_id: input.workspaceId, action: "patient_created", entity: "patients" });
  return code;
}

export async function updatePatient(id: string, input: { fullName: string; mobile: string; place: string; email?: string; gender?: string; dateOfBirth?: string | null; address?: string; emergencyContact?: string; notes?: string }) {
  forgetDeskLists();
  const patch: Record<string, unknown> = {
    full_name: input.fullName.trim(),
    mobile: input.mobile.trim(),
    place: input.place.trim(),
    updated_at: new Date().toISOString(),
  };
  if (input.email !== undefined) patch.email = input.email.trim();
  if (input.gender !== undefined) patch.gender = input.gender || "other";
  if (input.dateOfBirth !== undefined) {
    const dob = input.dateOfBirth || null;
    patch.date_of_birth = dob;
    patch.age = dob ? Math.max(0, new Date().getFullYear() - new Date(dob).getFullYear()) : null;
  }
  if (input.address !== undefined) patch.address = input.address.trim();
  if (input.emergencyContact !== undefined) patch.emergency_contact = input.emergencyContact.trim();
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  const { error } = await client().from("patients").update(patch).eq("id", id).is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function removePatientProduct(itemId: string) {
  forgetDeskLists();
  const { data, error } = await client().from("patient_procedure_items").select("id, product_id, quantity").eq("id", itemId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That product line was already removed.");
  const quantity = Number(data.quantity ?? 0);
  if (quantity > 0 && data.product_id) {
    const restored = await client().rpc("apply_stock_change", { product: data.product_id, kind: "return", qty: quantity, note: "Returned from the patient card" });
    if (restored.error) throw new Error(restored.error.message);
  }
  const removed = await client().from("patient_procedure_items").delete().eq("id", itemId);
  if (removed.error) throw new Error(removed.error.message);
}

export async function removePatient(id: string) {
  forgetDeskLists();
  const viaRpc = await client().rpc("soft_delete_patient", { p_id: id });
  if (!viaRpc.error) {
    forgetDeskLists();
    return;
  }
  // Fallback if RPC is missing — update then confirm the card is no longer active.
  const { error } = await client()
    .from("patients")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(error.message || viaRpc.error.message);
  const stillThere = await client().from("patients").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (stillThere.error) throw new Error(stillThere.error.message);
  if (stillThere.data) throw new Error(viaRpc.error.message || "Could not delete the patient. Try again.");
  forgetDeskLists();
}

export async function updateAppointmentStatus(id: string, status: string) {
  forgetDeskLists();
  const { error } = await client().from("appointments").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function mergeLeads(keeperId: string, duplicateId: string) {
  const { error } = await client().rpc("merge_leads", { keeper: keeperId, duplicate: duplicateId });
  if (error) throw new Error(error.message);
}

export async function removeAppointment(id: string) {
  forgetDeskLists();
  const removed = await client().from("appointments").delete().eq("id", id);
  if (!removed.error) return;
  // FK may block hard delete — mark cancelled and keep it out of desk lists.
  const { data, error } = await client()
    .from("appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not delete the appointment.");
}

export interface DeskAppointmentRow {
  id: string;
  startsAt: string;
  status: string;
  reason: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  patientMobile: string;
  doctorId: string;
}

export async function listDeskAppointments(workspaceId: string) {
  const { data, error } = await client()
    .from("appointments")
    .select("id, starts_at, status, reason, patient_id, doctor_id, patients(full_name, mobile, patient_code)")
    .eq("workspace_id", workspaceId)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const patient = row.patients as { full_name?: string; mobile?: string; patient_code?: string } | { full_name?: string; mobile?: string; patient_code?: string }[] | null;
    const named = Array.isArray(patient) ? patient[0] : patient;
    return {
      id: String(row.id),
      startsAt: String(row.starts_at || ""),
      status: String(row.status || ""),
      reason: String(row.reason || ""),
      patientId: String(row.patient_id || ""),
      patientName: named?.full_name || "Patient",
      patientCode: named?.patient_code || "",
      patientMobile: named?.mobile || "",
      doctorId: String(row.doctor_id || ""),
    } satisfies DeskAppointmentRow;
  });
}

export async function updateAppointment(id: string, patch: { startsAt?: string; status?: string; reason?: string; doctorId?: string | null }) {
  forgetDeskLists();
  const { error } = await client().from("appointments").update({
    ...(patch.startsAt ? { starts_at: patch.startsAt } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.reason != null ? { reason: patch.reason } : {}),
    ...(patch.doctorId !== undefined ? { doctor_id: patch.doctorId } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function rescheduleFollowUp(id: string, dueAt: string) {
  const { error } = await client().from("followups").update({ due_at: dueAt, status: "pending" }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addAppointmentFollowUp(input: { organizationId: string; workspaceId: string; leadId: string; dueAt: string; fullName: string }) {
  const actor = await userId();
  const { error } = await client().from("followups").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    assigned_to: actor,
    follow_type: "general",
    due_at: input.dueAt,
    notes: "Appointment",
    created_by: actor,
  });
  if (error) throw new Error(error.message);
  await client().from("leads").update({ next_follow_up_at: input.dueAt, updated_by: actor, updated_at: new Date().toISOString() }).eq("id", input.leadId);
  window.dispatchEvent(new CustomEvent("bitvion-followup", { detail: { id: input.leadId, fullName: input.fullName, dueAt: input.dueAt } }));
}

export async function listAppointments(workspaceId: string) {
  const { data, error } = await client().from("appointments").select("id, starts_at, status, reason, patient_id, doctor_id").eq("workspace_id", workspaceId).order("starts_at").limit(40);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createAppointment(input: { organizationId: string; workspaceId: string; patientId: string; doctorId: string | null; startsAt: string; reason: string; status?: string }) {
  forgetDeskLists();
  const { error } = await client().from("appointments").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    patient_id: input.patientId,
    starts_at: input.startsAt,
    reason: input.reason,
    status: input.status ?? "scheduled",
    doctor_id: input.doctorId,
    created_by: await userId(),
  });
  if (error) throw new Error(error.message);
}

function clinicDay(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function followUpStamp(value: string) {
  if (value.includes("T")) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const day = value.slice(0, 10);
  return new Date(`${day}T10:00:00+05:30`).toISOString();
}

export async function ensureFollowUpVisit(input: { organizationId: string; workspaceId: string; patientId: string; when: string; doctorId?: string | null; exact?: boolean }) {
  const startsAt = followUpStamp(input.when);
  if (Number.isNaN(new Date(startsAt).getTime())) throw new Error("Choose a follow-up date.");
  const day = clinicDay(startsAt);
  const existing = await client().from("appointments").select("id, starts_at, status, reason").eq("patient_id", input.patientId).in("status", ["scheduled", "confirmed"]);
  if (existing.error) throw new Error(existing.error.message);
  const rows = existing.data ?? [];
  const follow = rows.find((row) => String(row.reason || "") === "Follow-up");
  const sameDay = rows.find((row) => clinicDay(String(row.starts_at)) === day);
  if (!input.exact && follow && clinicDay(String(follow.starts_at)) === day) return;
  if (!input.exact && sameDay && String(sameDay.reason || "") !== "Follow-up") return;
  const target = follow ?? (input.exact ? undefined : sameDay);
  forgetDeskLists();
  if (target) {
    const { error } = await client().from("appointments").update({
      starts_at: startsAt,
      reason: "Follow-up",
      status: "scheduled",
      ...(input.doctorId !== undefined ? { doctor_id: input.doctorId } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", target.id);
    if (error) throw new Error(error.message);
    return;
  }
  await createAppointment({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    patientId: input.patientId,
    doctorId: input.doctorId ?? null,
    startsAt,
    reason: "Follow-up",
    status: "scheduled",
  });
}

async function clearFollowUpVisit(patientId: string) {
  forgetDeskLists();
  const { error } = await client().from("appointments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("patient_id", patientId).eq("reason", "Follow-up").in("status", ["scheduled", "confirmed"]);
  if (error) throw new Error(error.message);
}

export async function saveConsultation(input: { organizationId: string; workspaceId: string; patientId: string; diagnosis: string; plan: string; medicine: string; dosage: string; frequency?: string; duration?: string; instructions?: string; followUpOn: string | null }) {
  const { data, error } = await client().from("consultations").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    patient_id: input.patientId,
    doctor_id: await userId(),
    diagnosis: input.diagnosis,
    treatment_plan: input.plan,
    follow_up_on: input.followUpOn,
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (input.followUpOn) {
    await ensureFollowUpVisit({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      patientId: input.patientId,
      when: input.followUpOn,
    });
  }
  if (input.medicine.trim() || input.duration?.trim() || input.dosage.trim()) {
    const { error: prescriptionError } = await client().from("prescriptions").insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      consultation_id: data.id,
      medicine: input.medicine.trim() || "Medicine",
      dosage: input.dosage,
      frequency: input.frequency ?? "",
      duration: input.duration ?? "",
      instructions: input.instructions ?? "",
    });
    if (prescriptionError) throw new Error(prescriptionError.message);
  }
}

export async function updateProcedure(id: string, input: { procedure1: string; procedure2: string; performedOn: string; notes: string; doctorId: string | null }) {
  forgetDeskLists();
  const { error } = await client().from("patient_procedures").update({
    procedure_1: input.procedure1.trim(),
    procedure_2: input.procedure2.trim(),
    performed_on: input.performedOn || new Date().toISOString().slice(0, 10),
    notes: input.notes.trim(),
    doctor_id: input.doctorId,
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeProcedure(id: string) {
  const { data, error } = await client().from("patient_procedure_items").select("id").eq("procedure_id", id);
  if (error) throw new Error(error.message);
  for (const item of data ?? []) await removePatientProduct(String(item.id));
  forgetDeskLists();
  const removed = await client().from("patient_procedures").delete().eq("id", id);
  if (removed.error) throw new Error(removed.error.message);
}

export async function updateConsultation(id: string, input: { organizationId: string; workspaceId: string; diagnosis: string; plan: string; followUpOn: string | null; prescriptionId: string; medicine: string; dosage: string; frequency: string; duration: string; instructions: string }) {
  const current = await client().from("consultations").select("patient_id").eq("id", id).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const { error } = await client().from("consultations").update({
    diagnosis: input.diagnosis.trim(),
    treatment_plan: input.plan.trim(),
    follow_up_on: input.followUpOn,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  const patientId = current.data?.patient_id ? String(current.data.patient_id) : "";
  if (patientId && input.followUpOn) {
    await ensureFollowUpVisit({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      patientId,
      when: input.followUpOn,
    });
  } else if (patientId) {
    await clearFollowUpVisit(patientId);
  }
  const row = {
    medicine: input.medicine.trim(),
    dosage: input.dosage.trim(),
    frequency: input.frequency.trim(),
    duration: input.duration.trim(),
    instructions: input.instructions.trim(),
  };
  if (input.prescriptionId) {
    const saved = await client().from("prescriptions").update(row).eq("id", input.prescriptionId);
    if (saved.error) throw new Error(saved.error.message);
    return;
  }
  if (!row.medicine && !row.duration && !row.dosage) return;
  const created = await client().from("prescriptions").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    consultation_id: id,
    medicine: row.medicine || "Medicine",
    dosage: row.dosage,
    frequency: row.frequency,
    duration: row.duration,
    instructions: row.instructions,
  });
  if (created.error) throw new Error(created.error.message);
}

export async function removeConsultation(id: string) {
  const cleared = await client().from("prescriptions").delete().eq("consultation_id", id);
  if (cleared.error) throw new Error(cleared.error.message);
  const removed = await client().from("consultations").delete().eq("id", id);
  if (removed.error) throw new Error(removed.error.message);
}

export interface InventoryProduct {
  id: string;
  name: string;
  category: string;
  current_stock: number;
  minimum_stock: number;
  purchase_price: number | null;
  selling_price: number | null;
  expires_on: string | null;
  unit: string;
  supplier: string;
  sku?: string;
  is_active?: boolean;
}

export async function listProducts(workspaceId: string) {
  const { data, error } = await client()
    .from("inventory_products")
    .select("id, name, category, current_stock, minimum_stock, purchase_price, selling_price, expires_on, unit, supplier, sku, is_active")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("category")
    .order("name")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as InventoryProduct[];
}

export async function createProduct(input: { organizationId: string; workspaceId: string; name: string; stock: number; minimum: number; category?: string; batch?: string; expiresOn?: string | null; purchasePrice?: number; sellingPrice?: number; supplier?: string }) {
  const { data, error } = await client().from("inventory_products").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    name: input.name.trim(),
    category: (input.category ?? "").trim(),
    batch: input.batch ?? "",
    expires_on: input.expiresOn || null,
    purchase_price: input.purchasePrice ?? 0,
    selling_price: input.sellingPrice ?? 0,
    current_stock: 0,
    minimum_stock: input.minimum,
    supplier: input.supplier ?? "",
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (input.stock > 0) await changeStock(data.id as string, "purchase", input.stock, "Opening stock");
}

export async function updateProductPricing(input: { productId: string; sellingPrice: number; purchasePrice: number; minimumStock: number }) {
  const { error } = await client()
    .from("inventory_products")
    .update({
      selling_price: Math.max(0, input.sellingPrice),
      purchase_price: Math.max(0, input.purchasePrice),
      minimum_stock: Math.max(0, input.minimumStock),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.productId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function removeProduct(productId: string) {
  const userId = (await client().auth.getUser()).data.user?.id ?? null;
  const { error } = await client()
    .from("inventory_products")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function changeStock(productId: string, kind: "purchase" | "sale" | "adjustment" | "return" | "damaged" | "expired" | "treatment", quantity: number, note = "") {
  const signed = kind === "purchase" || kind === "return" ? Math.abs(quantity) : -Math.abs(quantity);
  const { error } = await client().rpc("apply_stock_change", { product: productId, kind, qty: signed, note });
  if (error) throw new Error(error.message);
}

export async function listStockMoves(workspaceId: string) {
  const { data, error } = await client().from("inventory_transactions").select("id, product_id, transaction_type, quantity, note, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function seedClinicSkincareStock() {
  const { data, error } = await client().rpc("seed_clinic_skincare_stock");
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface ClinicBillLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface ClinicBill {
  id: string;
  patientId: string;
  studentId: string;
  personName: string;
  number: string;
  issuedOn: string;
  status: string;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  items: ClinicBillLine[];
}

export async function listClinicBills(workspaceId: string) {
  const { data, error } = await client()
    .from("invoices")
    .select("id, invoice_number, patient_id, student_id, status, discount, total, issued_on, invoice_items(id, description, quantity, unit_price), payments(amount), patients(full_name), students(full_name)")
    .eq("workspace_id", workspaceId)
    .order("issued_on", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const items = ((row.invoice_items as Array<Record<string, unknown>> | null) ?? []).map((item) => {
      const quantity = Number(item.quantity ?? 1);
      const unitPrice = Number(item.unit_price ?? 0);
      return { id: String(item.id || ""), description: String(item.description || "Item"), quantity, unitPrice, amount: quantity * unitPrice };
    });
    const paid = ((row.payments as Array<{ amount?: number }> | null) ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const total = Number(row.total ?? 0);
    const patient = row.patients as { full_name?: string } | { full_name?: string }[] | null;
    const student = row.students as { full_name?: string } | { full_name?: string }[] | null;
    const patientName = (Array.isArray(patient) ? patient[0]?.full_name : patient?.full_name) || "";
    const studentName = (Array.isArray(student) ? student[0]?.full_name : student?.full_name) || "";
    return {
      id: String(row.id),
      patientId: String(row.patient_id || ""),
      studentId: String(row.student_id || ""),
      personName: patientName || studentName || "No person",
      number: String(row.invoice_number || ""),
      issuedOn: String(row.issued_on || ""),
      status: String(row.status || "pending"),
      discount: Number(row.discount ?? 0),
      total,
      paid,
      balance: balance(total, paid, 0),
      items,
    } satisfies ClinicBill;
  });
}

export async function createPatientBill(input: {
  organizationId: string;
  workspaceId: string;
  patientId: string;
  discount: number;
  paid: number;
  method: "cash" | "upi" | "card" | "bank_transfer" | "online_payment";
  lines: Array<{ kind: "Treatment" | "Booking" | "Product"; description: string; quantity: number; unitPrice: number }>;
}) {
  forgetDeskLists();
  const lines = input.lines
    .map((line) => ({ ...line, description: line.description.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }))
    .filter((line) => line.description && line.quantity > 0 && line.unitPrice >= 0);
  if (!lines.length) throw new Error("Add a treatment, booking, or product charge.");
  if (input.discount < 0 || input.paid < 0) throw new Error("Amounts cannot be negative.");
  const total = invoiceTotal(lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice })), input.discount);
  if (input.paid > total) throw new Error("The amount received is higher than the bill.");
  const number = `INV-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await client().from("invoices").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    invoice_number: number,
    patient_id: input.patientId,
    discount: input.discount,
    total,
    issued_on: new Date().toISOString().slice(0, 10),
    created_by: await userId(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: itemError } = await client().from("invoice_items").insert(lines.map((line) => ({
    invoice_id: data.id,
    description: `${line.kind} · ${line.description}`,
    quantity: line.quantity,
    unit_price: line.unitPrice,
  })));
  if (itemError) throw new Error(itemError.message);
  if (input.paid > 0) {
    await recordPayment({ organizationId: input.organizationId, workspaceId: input.workspaceId, invoiceId: data.id as string, amount: input.paid, method: input.method });
  }
  return { id: data.id as string, number, total };
}

export async function addToPatientBill(input: {
  organizationId: string;
  workspaceId: string;
  patientId: string;
  discount: number;
  paid: number;
  method: "cash" | "upi" | "card" | "bank_transfer" | "online_payment";
  lines: Array<{ kind: "Treatment" | "Booking" | "Product"; description: string; quantity: number; unitPrice: number }>;
}) {
  const lines = input.lines
    .map((line) => ({ ...line, description: line.description.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }))
    .filter((line) => line.description && line.quantity > 0 && line.unitPrice >= 0);
  if (!lines.length) throw new Error("Add a treatment, booking, or product charge.");
  const open = await client()
    .from("invoices")
    .select("id, invoice_number, discount, invoice_items(quantity, unit_price), payments(amount)")
    .eq("workspace_id", input.workspaceId)
    .eq("patient_id", input.patientId)
    .not("status", "in", "(cancelled,refunded)")
    .order("issued_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open.error) throw new Error(open.error.message);
  const current = open.data;
  if (!current) return createPatientBill(input);
  forgetDeskLists();
  const currentItems = ((current.invoice_items as Array<{ quantity?: number; unit_price?: number }> | null) ?? []).map((item) => ({
    quantity: Number(item.quantity ?? 1),
    unitPrice: Number(item.unit_price ?? 0),
  }));
  const alreadyPaid = ((current.payments as Array<{ amount?: number }> | null) ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const discount = Number(current.discount ?? 0) + Math.max(0, input.discount);
  const total = invoiceTotal([...currentItems, ...lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice }))], discount);
  if (input.paid < 0 || alreadyPaid + input.paid > total) throw new Error("The amount received is higher than the balance.");
  const added = await client().from("invoice_items").insert(lines.map((line) => ({
    invoice_id: current.id,
    description: `${line.kind} · ${line.description}`,
    quantity: line.quantity,
    unit_price: line.unitPrice,
  })));
  if (added.error) throw new Error(added.error.message);
  const paid = alreadyPaid + Math.max(0, input.paid);
  const due = balance(total, paid, 0);
  const status = due === 0 ? "paid" : paid > 0 ? "partial" : "pending";
  const saved = await client().from("invoices").update({ discount, total, status }).eq("id", current.id);
  if (saved.error) throw new Error(saved.error.message);
  if (input.paid > 0) {
    await recordPayment({ organizationId: input.organizationId, workspaceId: input.workspaceId, invoiceId: current.id as string, amount: input.paid, method: input.method });
  }
  return { id: current.id as string, number: String(current.invoice_number || ""), total };
}

export async function addToStudentBill(input: {
  organizationId: string;
  workspaceId: string;
  studentId: string;
  discount: number;
  paid: number;
  method: "cash" | "upi" | "card" | "bank_transfer" | "online_payment";
  lines: Array<{ kind: "Course fee" | "Registration" | "Material" | "Exam" | "Certificate"; description: string; quantity: number; unitPrice: number }>;
}) {
  const lines = input.lines
    .map((line) => ({ ...line, description: line.description.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }))
    .filter((line) => line.description && line.quantity > 0 && line.unitPrice >= 0);
  if (!lines.length) throw new Error("Add a course fee, registration, material, exam, or certificate charge.");
  const open = await client()
    .from("invoices")
    .select("id, invoice_number, discount, invoice_items(quantity, unit_price), payments(amount)")
    .eq("workspace_id", input.workspaceId)
    .eq("student_id", input.studentId)
    .not("status", "in", "(cancelled,refunded)")
    .order("issued_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open.error) throw new Error(open.error.message);
  const current = open.data;
  if (input.discount < 0 || input.paid < 0) throw new Error("Amounts cannot be negative.");
  if (!current) {
    forgetDeskLists();
    const total = invoiceTotal(lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice })), input.discount);
    if (input.paid > total) throw new Error("The amount received is higher than the bill.");
    const number = `INV-${Date.now().toString(36).toUpperCase()}`;
    const created = await client().from("invoices").insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      invoice_number: number,
      student_id: input.studentId,
      discount: input.discount,
      total,
      issued_on: new Date().toISOString().slice(0, 10),
      created_by: await userId(),
    }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    const items = await client().from("invoice_items").insert(lines.map((line) => ({
      invoice_id: created.data.id,
      description: `${line.kind} · ${line.description}`,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    })));
    if (items.error) throw new Error(items.error.message);
    if (input.paid > 0) await recordPayment({ organizationId: input.organizationId, workspaceId: input.workspaceId, invoiceId: created.data.id as string, amount: input.paid, method: input.method });
    return { id: created.data.id as string, number, total };
  }
  forgetDeskLists();
  const currentItems = ((current.invoice_items as Array<{ quantity?: number; unit_price?: number }> | null) ?? []).map((item) => ({
    quantity: Number(item.quantity ?? 1),
    unitPrice: Number(item.unit_price ?? 0),
  }));
  const alreadyPaid = ((current.payments as Array<{ amount?: number }> | null) ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const discount = Number(current.discount ?? 0) + Math.max(0, input.discount);
  const total = invoiceTotal([...currentItems, ...lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice }))], discount);
  if (alreadyPaid + input.paid > total) throw new Error("The amount received is higher than the balance.");
  const added = await client().from("invoice_items").insert(lines.map((line) => ({
    invoice_id: current.id,
    description: `${line.kind} · ${line.description}`,
    quantity: line.quantity,
    unit_price: line.unitPrice,
  })));
  if (added.error) throw new Error(added.error.message);
  const paid = alreadyPaid + Math.max(0, input.paid);
  const due = balance(total, paid, 0);
  const status = due === 0 ? "paid" : paid > 0 ? "partial" : "pending";
  const saved = await client().from("invoices").update({ discount, total, status }).eq("id", current.id);
  if (saved.error) throw new Error(saved.error.message);
  if (input.paid > 0) await recordPayment({ organizationId: input.organizationId, workspaceId: input.workspaceId, invoiceId: current.id as string, amount: input.paid, method: input.method });
  return { id: current.id as string, number: String(current.invoice_number || ""), total };
}

export async function createInvoice(input: { organizationId: string; workspaceId: string; patientId: string | null; studentId?: string | null; description: string; quantity: number; unitPrice: number; discount: number; issuedOn?: string | null }) {
  const total = invoiceTotal([{ quantity: input.quantity, unitPrice: input.unitPrice }], input.discount);
  const number = `INV-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await client().from("invoices").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    invoice_number: number,
    patient_id: input.patientId,
    student_id: input.studentId || null,
    discount: input.discount,
    total,
    issued_on: input.issuedOn || new Date().toISOString().slice(0, 10),
    created_by: await userId(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: itemError } = await client().from("invoice_items").insert({ invoice_id: data.id, description: input.description, quantity: input.quantity, unit_price: input.unitPrice });
  if (itemError) throw new Error(itemError.message);
  return { id: data.id as string, number, total };
}

export async function recordPayment(input: { organizationId: string; workspaceId: string; invoiceId: string; amount: number; method: "cash" | "upi" | "card" | "bank_transfer" | "online_payment" }) {
  const { error } = await client().from("payments").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    invoice_id: input.invoiceId,
    amount: input.amount,
    method: input.method,
    created_by: await userId(),
  });
  if (error) throw new Error(error.message);
  const { data: invoice, error: invoiceError } = await client().from("invoices").select("total, discount").eq("id", input.invoiceId).single();
  if (invoiceError) throw new Error(invoiceError.message);
  const { data: payments, error: paymentsError } = await client().from("payments").select("amount").eq("invoice_id", input.invoiceId);
  if (paymentsError) throw new Error(paymentsError.message);
  const paid = (payments ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const due = balance(Number(invoice.total), paid, 0);
  const status = due === 0 ? "paid" : paid > 0 ? "partial" : "pending";
  const { error: statusError } = await client().from("invoices").update({ status }).eq("id", input.invoiceId);
  if (statusError) throw new Error(statusError.message);
}

export async function recordRefund(input: { organizationId: string; workspaceId: string; invoiceId: string; amount: number }) {
  const { error } = await client().from("refunds").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    invoice_id: input.invoiceId,
    amount: input.amount,
    created_by: await userId(),
  });
  if (error) throw new Error(error.message);
  const { error: statusError } = await client().from("invoices").update({ status: "refunded" }).eq("id", input.invoiceId);
  if (statusError) throw new Error(statusError.message);
}

async function syncInvoiceTotals(invoiceId: string) {
  const { data: invoice, error: invoiceError } = await client()
    .from("invoices")
    .select("id, discount, status, invoice_items(quantity, unit_price), payments(amount)")
    .eq("id", invoiceId)
    .single();
  if (invoiceError) throw new Error(invoiceError.message);
  if (invoice.status === "cancelled" || invoice.status === "refunded") return;
  const items = ((invoice.invoice_items as Array<{ quantity?: number; unit_price?: number }> | null) ?? []).map((item) => ({
    quantity: Number(item.quantity ?? 1),
    unitPrice: Number(item.unit_price ?? 0),
  }));
  const paid = ((invoice.payments as Array<{ amount?: number }> | null) ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const discount = Number(invoice.discount ?? 0);
  const total = items.length ? invoiceTotal(items, discount) : 0;
  const due = balance(total, paid, 0);
  const status = items.length === 0 ? "cancelled" : due === 0 ? "paid" : paid > 0 ? "partial" : "pending";
  const { error } = await client().from("invoices").update({ total, status }).eq("id", invoiceId);
  if (error) throw new Error(error.message);
}

export async function updateInvoiceItem(input: { itemId: string; description: string; quantity: number; unitPrice: number }) {
  const description = input.description.trim();
  const quantity = Number(input.quantity);
  const unitPrice = Number(input.unitPrice);
  if (!description) throw new Error("Enter a charge name.");
  if (!(quantity > 0) || unitPrice < 0) throw new Error("Quantity and price must be valid.");
  forgetDeskLists();
  const { data, error } = await client()
    .from("invoice_items")
    .update({ description, quantity, unit_price: unitPrice })
    .eq("id", input.itemId)
    .select("invoice_id")
    .single();
  if (error) throw new Error(error.message);
  await syncInvoiceTotals(String(data.invoice_id));
}

export async function removeInvoiceItem(itemId: string) {
  forgetDeskLists();
  const { data, error } = await client().from("invoice_items").delete().eq("id", itemId).select("invoice_id").single();
  if (error) throw new Error(error.message);
  await syncInvoiceTotals(String(data.invoice_id));
}

export async function cancelClinicBill(invoiceId: string) {
  forgetDeskLists();
  const { error: itemsError } = await client().from("invoice_items").delete().eq("invoice_id", invoiceId);
  if (itemsError) throw new Error(itemsError.message);
  const { error } = await client().from("invoices").update({ total: 0, status: "cancelled" }).eq("id", invoiceId);
  if (error) throw new Error(error.message);
}

export async function revenueSummary(workspaceId: string, from = "1970-01-01", to = "2999-12-31") {
  const { data, error } = await client().rpc("revenue_totals", { ws: workspaceId, from_date: from, to_date: to });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    gross: Number(row?.gross ?? 0),
    discounts: Number(row?.discounts ?? 0),
    collected: Number(row?.collected ?? 0),
    refunded: Number(row?.refunded ?? 0),
    net: Number(row?.net ?? 0),
    pending: Number(row?.pending ?? 0),
  };
}

export type StudentDetails = {
  fullName: string;
  mobile: string;
  email: string;
  gender: string;
  dateOfBirth: string | null;
  address: string;
  course: string;
  batch: string;
  admissionDate: string | null;
  status: string;
  appointmentAt?: string;
  fee?: string;
  paid?: string;
  method?: "cash" | "upi" | "card";
};

async function ensureCourse(organizationId: string, workspaceId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const found = await client().from("courses").select("id").eq("workspace_id", workspaceId).eq("name", trimmed).limit(1).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (found.data?.id) return found.data.id as string;
  return createCourse({ organizationId, workspaceId, name: trimmed });
}

async function ensureBatch(organizationId: string, workspaceId: string, courseId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const found = await client().from("batches").select("id").eq("workspace_id", workspaceId).eq("course_id", courseId).eq("name", trimmed).limit(1).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (found.data?.id) return found.data.id as string;
  const created = await client().from("batches").insert({ organization_id: organizationId, workspace_id: workspaceId, course_id: courseId, name: trimmed }).select("id").single();
  if (created.error) throw new Error(created.error.message);
  return created.data.id as string;
}

export async function saveStudentDetails(id: string, organizationId: string, workspaceId: string, input: StudentDetails, options?: { settle?: boolean }) {
  forgetDeskLists();
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Enter the student name.");
  const courseId = await ensureCourse(organizationId, workspaceId, input.course);
  const batchId = courseId ? await ensureBatch(organizationId, workspaceId, courseId, input.batch) : null;
  const { error } = await client().from("students").update({
    full_name: fullName,
    mobile: input.mobile.trim(),
    email: input.email.trim(),
    gender: input.gender || "other",
    date_of_birth: input.dateOfBirth || null,
    address: input.address.trim(),
    admission_date: input.admissionDate || null,
    status: input.status || "admitted",
    ...(courseId ? { course_id: courseId } : {}),
    ...(batchId ? { batch_id: batchId } : {}),
  }).eq("id", id).is("deleted_at", null);
  if (error) throw new Error(error.message);
  if ((options?.settle ?? true) && input.status === "booked") await settleStudentBooking(id, organizationId, workspaceId, input);
}

export async function settleStudentBooking(id: string, organizationId: string, workspaceId: string, input: StudentDetails) {
  const bookedOn = input.admissionDate || "";
  const appointmentAt = input.appointmentAt || "";
  const fee = Number(input.fee || 0);
  const paid = Number(input.paid || 0);
  if (!bookedOn) throw new Error("Choose the booked date.");
  if (!appointmentAt || Number.isNaN(new Date(appointmentAt).getTime())) throw new Error("Choose the appointment date.");
  if (fee < 0 || paid < 0) throw new Error("Amounts cannot be negative.");
  if (paid > fee) throw new Error("The amount paid is higher than the fee.");
  const student = await client().from("students").select("lead_id").eq("id", id).maybeSingle();
  if (student.error) throw new Error(student.error.message);
  const leadId = student.data?.lead_id ? String(student.data.lead_id) : "";
  const actor = await userId();
  if (leadId) {
    const leadUpdate = await client().from("leads").update({
      full_name: input.fullName.trim(),
      phone: input.mobile.trim(),
      email: input.email.trim(),
      position: input.course.trim(),
      status: "selected",
      next_follow_up_at: new Date(appointmentAt).toISOString(),
      updated_by: actor,
      updated_at: new Date().toISOString(),
    }).eq("id", leadId);
    if (leadUpdate.error) throw new Error(leadUpdate.error.message);
    const follow = await client().from("followups").insert({
      organization_id: organizationId,
      workspace_id: workspaceId,
      lead_id: leadId,
      assigned_to: actor,
      follow_type: "general",
      due_at: new Date(appointmentAt).toISOString(),
      notes: "Appointment",
      created_by: actor,
    });
    if (follow.error) throw new Error(follow.error.message);
    window.dispatchEvent(new CustomEvent("bitvion-followup", { detail: { id: leadId, fullName: input.fullName.trim(), dueAt: new Date(appointmentAt).toISOString() } }));
  }
  if (fee > 0) {
    const invoice = await createInvoice({
      organizationId,
      workspaceId,
      patientId: null,
      studentId: id,
      description: input.course.trim() || "Booking",
      quantity: 1,
      unitPrice: fee,
      discount: 0,
      issuedOn: bookedOn,
    });
    if (paid > 0) await recordPayment({ organizationId, workspaceId, invoiceId: invoice.id, amount: paid, method: input.method || "cash" });
  }
}

export async function removeStudent(id: string) {
  forgetDeskLists();
  const { error } = await client().from("students").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function listStudents(workspaceId: string) {
  const { data, error } = await client().from("students").select("id, student_code, full_name, status, admission_date").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCourse(input: { organizationId: string; workspaceId: string; name: string }) {
  const { data, error } = await client().from("courses").insert({ organization_id: input.organizationId, workspace_id: input.workspaceId, name: input.name }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function savePersonPhoto(table: "students" | "patients", id: string, organizationId: string, workspaceId: string, file: File) {
  forgetDeskLists();
  await uploadPrivateFile({ organizationId, workspaceId, entityType: table, entityId: id, file, category: "photo" });
  const { data, error } = await client().from("documents").select("storage_path").eq("entity_id", id).eq("category", "photo").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const path = String(data?.storage_path || "");
  if (!path) throw new Error("Photo was uploaded but could not be saved on the card.");
  const saved = await client().from(table).update({ photo_path: path }).eq("id", id).is("deleted_at", null);
  if (saved.error) throw new Error(saved.error.message);
  return path;
}

export async function createStudent(input: { organizationId: string; workspaceId: string; fullName: string; mobile: string; email?: string; gender?: string; dateOfBirth?: string | null; address?: string; courseId: string | null; courseName?: string; leadId?: string | null; batchName?: string; admissionDate?: string | null; status?: string; photo?: File | null; appointmentAt?: string; fee?: string; paid?: string; method?: "cash" | "upi" | "card" }) {
  forgetDeskLists();
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Enter the student name.");
  const code = await serverCode("next_student_code", `IAA-S-${Date.now().toString(36).toUpperCase()}`);
  const courseId = input.courseId ?? await ensureCourse(input.organizationId, input.workspaceId, input.courseName || "");
  const batchId = courseId ? await ensureBatch(input.organizationId, input.workspaceId, courseId, input.batchName || "") : null;
  const { data, error } = await client().from("students").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId || null,
    student_code: code,
    full_name: input.fullName.trim(),
    mobile: input.mobile.trim(),
    email: input.email?.trim() || "",
    gender: input.gender || "other",
    date_of_birth: input.dateOfBirth || null,
    address: input.address?.trim() || "",
    course_id: courseId,
    batch_id: batchId,
    admission_date: input.admissionDate || null,
    status: input.status || "admitted",
    counsellor_id: await userId(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: admissionError } = await client().from("admissions").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    student_id: data.id,
    course_id: courseId,
    batch_id: batchId,
    admitted_on: input.admissionDate || new Date().toISOString().slice(0, 10),
    status: input.status || "admitted",
  });
  if (admissionError) throw new Error(admissionError.message);
  if (input.photo && input.photo.size > 0) await savePersonPhoto("students", data.id as string, input.organizationId, input.workspaceId, input.photo);
  if (input.status === "booked") {
    await settleStudentBooking(data.id as string, input.organizationId, input.workspaceId, {
      fullName,
      mobile: input.mobile,
      email: input.email || "",
      gender: input.gender || "other",
      dateOfBirth: input.dateOfBirth || null,
      address: input.address || "",
      course: input.courseName || "",
      batch: input.batchName || "",
      admissionDate: input.admissionDate || null,
      status: "booked",
      appointmentAt: input.appointmentAt,
      fee: input.fee,
      paid: input.paid,
      method: input.method,
    });
  }
  return code;
}

export async function bookFromLead(input: {
  leadId: string;
  organizationId: string;
  workspaceId: string;
  fromStatus: string;
  institute: boolean;
  fullName: string;
  phone: string;
  email: string;
  place: string;
  interest: string;
  gender: string;
  dateOfBirth: string | null;
  address: string;
  bookedOn: string;
  appointmentAt: string;
  fee: number;
  paid: number;
  method: "cash" | "upi" | "card" | "bank_transfer" | "online_payment";
}) {
  const name = input.fullName.trim();
  if (!name) throw new Error("Enter the name.");
  if (!input.bookedOn) throw new Error("Choose the booked date.");
  if (!input.appointmentAt || Number.isNaN(new Date(input.appointmentAt).getTime())) throw new Error("Choose the appointment date.");
  if (input.fee < 0 || input.paid < 0) throw new Error("Amounts cannot be negative.");
  if (input.paid > input.fee) throw new Error("The amount paid is higher than the fee.");
  const actor = await userId();
  const leadUpdate = await client().from("leads").update({
    full_name: name,
    phone: input.phone.trim(),
    email: input.email.trim(),
    location: input.place.trim(),
    position: input.interest.trim(),
    status: "selected",
    next_follow_up_at: new Date(input.appointmentAt).toISOString(),
    updated_by: actor,
    updated_at: new Date().toISOString(),
  }).eq("id", input.leadId);
  if (leadUpdate.error) throw new Error(leadUpdate.error.message);
  const history = await client().from("lead_status_history").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    from_status: input.fromStatus,
    to_status: "selected",
    changed_by: actor,
  });
  if (history.error) throw new Error(history.error.message);
  let personId: string | null = null;
  if (input.institute) {
    const existing = await client().from("students").select("id").eq("lead_id", input.leadId).is("deleted_at", null).limit(1).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) {
      personId = String(existing.data.id);
      await saveStudentDetails(personId, input.organizationId, input.workspaceId, {
        fullName: name,
        mobile: input.phone,
        email: input.email,
        gender: input.gender || "other",
        dateOfBirth: input.dateOfBirth,
        address: input.address,
        course: input.interest,
        batch: "",
        admissionDate: input.bookedOn,
        status: "admitted",
      });
    } else {
      await createStudent({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        fullName: name,
        mobile: input.phone,
        email: input.email,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth,
        address: input.address,
        courseId: null,
        courseName: input.interest,
        admissionDate: input.bookedOn,
        status: "admitted",
        leadId: input.leadId,
      });
      const created = await client().from("students").select("id").eq("lead_id", input.leadId).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (created.error) throw new Error(created.error.message);
      personId = created.data?.id ? String(created.data.id) : null;
    }
  } else {
    const existing = await client().from("patients").select("id").eq("lead_id", input.leadId).is("deleted_at", null).limit(1).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) {
      personId = String(existing.data.id);
      const dob = input.dateOfBirth || null;
      const saved = await client().from("patients").update({
        full_name: name,
        mobile: input.phone.trim(),
        email: input.email.trim(),
        gender: input.gender || "other",
        date_of_birth: dob,
        age: dob ? Math.max(0, new Date().getFullYear() - new Date(dob).getFullYear()) : null,
        place: input.place.trim(),
        address: input.address,
        notes: input.interest,
        updated_at: new Date().toISOString(),
      }).eq("id", personId).is("deleted_at", null);
      if (saved.error) throw new Error(saved.error.message);
    } else {
      await createPatient({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        fullName: name,
        mobile: input.phone,
        place: input.place,
        email: input.email,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth,
        address: input.address,
        notes: input.interest,
        leadId: input.leadId,
      });
      const created = await client().from("patients").select("id").eq("lead_id", input.leadId).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (created.error) throw new Error(created.error.message);
      personId = created.data?.id ? String(created.data.id) : null;
    }
    if (!personId) throw new Error("The patient record was not created.");
    await createAppointment({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      patientId: personId,
      doctorId: null,
      startsAt: new Date(input.appointmentAt).toISOString(),
      reason: input.interest || "Booked visit",
      status: "scheduled",
    });
  }
  const follow = await client().from("followups").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    assigned_to: actor,
    follow_type: "general",
    due_at: new Date(input.appointmentAt).toISOString(),
    notes: "Appointment",
    created_by: actor,
  });
  if (follow.error) throw new Error(follow.error.message);
  window.dispatchEvent(new CustomEvent("bitvion-followup", { detail: { id: input.leadId, fullName: name, dueAt: new Date(input.appointmentAt).toISOString() } }));
  let balanceDue = input.fee - input.paid;
  if (input.fee > 0) {
    const invoice = await createInvoice({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      patientId: input.institute ? null : personId,
      studentId: input.institute ? personId : null,
      description: input.interest || "Booking",
      quantity: 1,
      unitPrice: input.fee,
      discount: 0,
      issuedOn: input.bookedOn,
    });
    if (input.paid > 0) await recordPayment({ organizationId: input.organizationId, workspaceId: input.workspaceId, invoiceId: invoice.id, amount: input.paid, method: input.method });
    balanceDue = input.fee - input.paid;
  }
  return { balance: balanceDue };
}

export async function uploadPrivateFile(input: { organizationId: string; workspaceId: string; entityType: string; entityId: string; file: File; category: string }) {
  if (input.entityType === "student" && input.category !== "photo" && !isAllowedDocument(input.file)) {
    throw new Error("Use a PDF, JPG, JPEG, PNG, or WEBP file.");
  }
  const optimized = input.category === "marketing" || input.category === "photo"
    ? await optimizeImage(input.file)
    : input.entityType === "student"
      ? await optimizeDocument(input.file)
      : input.file;
  const checksum = await sha256(optimized);
  const { data: existing, error: existingError } = await client().from("documents").select("id, storage_path").eq("organization_id", input.organizationId).eq("checksum", checksum).limit(1);
  if (existingError) throw new Error(existingError.message);
  const safeName = optimized.name.replace(/[^\w.\-()+ ]+/g, "_");
  const path = existing?.[0]?.storage_path as string | undefined ?? `${input.organizationId}/${input.workspaceId}/${input.entityType}/${crypto.randomUUID()}-${safeName}`;
  if (!existing?.length) {
    const { error } = await client().storage.from("documents").upload(path, optimized, { contentType: optimized.type || "application/octet-stream", upsert: false });
    if (error) throw new Error(error.message);
  }
  const { error } = await client().from("documents").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    category: input.category,
    filename: input.file.name,
    mime_type: optimized.type || input.file.type,
    original_size: input.file.size,
    optimized_size: optimized.size,
    checksum,
    storage_path: path,
    processing_status: "ready",
    created_by: await userId(),
  });
  if (error) throw new Error(error.message);
  return { originalSize: input.file.size, optimizedSize: optimized.size };
}

export async function updateDocument(id: string, patch: { category?: string; verificationStatus?: string }) {
  const { error } = await client().from("documents").update({
    ...(patch.category ? { category: patch.category } : {}),
    ...(patch.verificationStatus ? { verification_status: patch.verificationStatus } : {}),
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeDocument(id: string) {
  const current = await client().from("documents").select("id, storage_path").eq("id", id).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) return;
  const path = String(current.data.storage_path || "");
  const removed = await client().from("documents").delete().eq("id", id);
  if (removed.error) throw new Error(removed.error.message);
  if (!path) return;
  const others = await client().from("documents").select("id").eq("storage_path", path).limit(1);
  if (others.error || (others.data ?? []).length) return;
  await client().storage.from("documents").remove([path]);
}

export async function listIntegrationStatus(organizationId: string) {
  const { data, error } = await client().from("integration_status").select("provider, status, detail").eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  const known = ["meta", "whatsapp", "ai"];
  return known.map((provider) => {
    const row = (data ?? []).find((item) => item.provider === provider);
    return { provider, status: (row?.status as string | undefined) ?? "configuration_required", detail: (row?.detail as string | undefined) ?? "Configuration Required" };
  });
}

export async function createExam(input: { organizationId: string; workspaceId: string; name: string; heldOn: string | null }) {
  const { error } = await client().from("exams").insert({ organization_id: input.organizationId, workspace_id: input.workspaceId, name: input.name, held_on: input.heldOn });
  if (error) throw new Error(error.message);
}

export async function recordMark(input: { examId: string; studentId: string; score: number }) {
  const { error } = await client().from("marks").upsert({ exam_id: input.examId, student_id: input.studentId, score: input.score }, { onConflict: "exam_id,student_id" });
  if (error) throw new Error(error.message);
}

export async function issueCertificate(input: { organizationId: string; workspaceId: string; studentId: string; title: string; number?: string; issuedOn?: string | null; status?: string }) {
  const { error } = await client().from("certificates").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    student_id: input.studentId,
    title: input.title,
    certificate_number: input.number ?? "",
    issued_on: input.issuedOn || new Date().toISOString().slice(0, 10),
    status: input.status || "issued",
  });
  if (error) throw new Error(error.message);
}

export async function listCertificates(workspaceId: string) {
  const { data, error } = await client().from("certificates").select("id, student_id, title, certificate_number, issued_on, status").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listStudentFile(workspaceId: string, studentId: string) {
  const [documents, marks, certificates] = await Promise.all([
    client().from("documents").select("id, filename, category, verification_status, storage_path, original_size, optimized_size, mime_type, created_at").eq("workspace_id", workspaceId).eq("entity_id", studentId).neq("category", "photo").order("created_at", { ascending: false }).limit(40),
    client().from("marks").select("id, score, exams(name, held_on)").eq("student_id", studentId),
    client().from("certificates").select("id, title, certificate_number, issued_on, status").eq("workspace_id", workspaceId).eq("student_id", studentId).order("issued_on", { ascending: false }).limit(20),
  ]);
  if (documents.error) throw new Error(documents.error.message);
  if (marks.error) throw new Error(marks.error.message);
  if (certificates.error) throw new Error(certificates.error.message);
  return {
    documents: (documents.data ?? []).map((row) => ({
      id: String(row.id),
      filename: String(row.filename || "Document"),
      category: String(row.category || ""),
      verification_status: String(row.verification_status || "pending"),
      storage_path: String(row.storage_path || ""),
      originalSize: Number(row.original_size ?? 0),
      optimizedSize: Number(row.optimized_size ?? row.original_size ?? 0),
      mimeType: String(row.mime_type || ""),
      created_at: String(row.created_at || ""),
    })),
    marks: (marks.data ?? []).map((row) => {
      const exam = row.exams as { name?: string; held_on?: string } | { name?: string; held_on?: string }[] | null;
      const named = Array.isArray(exam) ? exam[0] : exam;
      return { id: String(row.id), score: String(row.score ?? ""), exam: named?.name || "Exam", held_on: named?.held_on ? String(named.held_on) : "" };
    }),
    certificates: (certificates.data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title || ""),
      certificate_number: String(row.certificate_number || ""),
      issued_on: row.issued_on ? String(row.issued_on) : "",
      status: String(row.status || ""),
    })),
  };
}

export async function listDocuments(workspaceId: string, entityId: string) {
  const { data, error } = await client().from("documents").select("id, filename, category, verification_status, storage_path, created_at").eq("workspace_id", workspaceId).eq("entity_id", entityId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setDocumentStatus(id: string, status: string) {
  const { error } = await client().from("documents").update({ verification_status: status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listExams(workspaceId: string) {
  const { data, error } = await client().from("exams").select("id, name, held_on").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listAudit(workspaceId: string) {
  const { data, error } = await client().from("audit_logs").select("id, action, entity, created_at, user_id").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function signedDocumentUrl(path: string, seconds = 3600) {
  const { data, error } = await client().storage.from("documents").createSignedUrl(path, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function countRows(table: "leads" | "patients" | "appointments" | "students" | "followups", workspaceId: string) {
  let request = client().from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (table === "leads" || table === "patients" || table === "students") request = request.is("deleted_at", null);
  const { count, error } = await request;
  if (error) return 0;
  return count ?? 0;
}

export async function listVisibleMessages() {
  const { data, error } = await client().from("messages").select("id, body, direction, status, created_at").order("created_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  return data ?? [];
}

import { elapsedSeconds, remainingSeconds, sumCompleted } from "@/lib/call-time";
import { balance, invoiceTotal } from "@/lib/money";
import { optimizeImage, sha256 } from "@/lib/files";
import { supabase } from "@/lib/supabase";

function client() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

async function userId() {
  const { data, error } = await client().auth.getUser();
  if (error || !data.user) throw new Error(error?.message ?? "Configuration Required");
  return data.user.id;
}

export async function listFollowUps(workspaceId: string) {
  const { data, error } = await client().from("followups").select("id, lead_id, due_at, status, notes").eq("workspace_id", workspaceId).order("due_at").limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listTasks(workspaceId: string) {
  const { data, error } = await client().from("tasks").select("id, title, status, priority, due_at, assigned_to").eq("workspace_id", workspaceId).is("deleted_at", null).order("due_at").limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
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

export async function startCall(organizationId: string, workspaceId: string) {
  const uid = await userId();
  const { data: active, error: activeError } = await client().from("call_time_sessions").select("id").eq("user_id", uid).eq("status", "active");
  if (activeError) throw new Error(activeError.message);
  if (active?.length) {
    const { error } = await client().from("call_time_sessions").update({ status: "interrupted", ended_at: new Date().toISOString(), duration_seconds: null }).in("id", active.map((row) => row.id as string));
    if (error) throw new Error(error.message);
  }
  const { data, error } = await client().from("call_time_sessions").insert({ organization_id: organizationId, workspace_id: workspaceId, user_id: uid, status: "active" }).select("id, started_at").single();
  if (error) throw new Error(error.message);
  return data as { id: string; started_at: string };
}

export async function endCall(sessionId: string) {
  const endedAt = new Date().toISOString();
  const { data, error } = await client().from("call_time_sessions").select("started_at, status").eq("id", sessionId).single();
  if (error) throw new Error(error.message);
  if (data.status !== "active") throw new Error("This timing session is not active.");
  const duration = elapsedSeconds(data.started_at as string, endedAt);
  if (duration === null) throw new Error("The timer could not be calculated. It was not added to call time.");
  const { error: updateError } = await client().from("call_time_sessions").update({ status: "completed", ended_at: endedAt, duration_seconds: duration }).eq("id", sessionId).eq("status", "active");
  if (updateError) throw new Error(updateError.message);
  return duration;
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

export async function listPatients(workspaceId: string, search: string) {
  let request = client().from("patients").select("id, patient_code, full_name, mobile, place").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30);
  if (search.trim()) request = request.ilike("full_name", `%${search.trim().replace(/[%_]/g, "")}%`);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createPatient(input: { organizationId: string; workspaceId: string; fullName: string; mobile: string; place: string; email?: string; gender?: string; dateOfBirth?: string | null; address?: string; emergencyContact?: string; notes?: string; leadId?: string | null }) {
  const code = `PT-${Date.now().toString(36).toUpperCase()}`;
  const dob = input.dateOfBirth || null;
  const age = dob ? Math.max(0, new Date().getFullYear() - new Date(dob).getFullYear()) : null;
  const { error } = await client().from("patients").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId || null,
    patient_code: code,
    full_name: input.fullName.trim(),
    mobile: input.mobile.trim(),
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

export async function updateAppointmentStatus(id: string, status: string) {
  const { error } = await client().from("appointments").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function mergeLeads(keeperId: string, duplicateId: string) {
  const { error } = await client().rpc("merge_leads", { keeper: keeperId, duplicate: duplicateId });
  if (error) throw new Error(error.message);
}

export async function listAppointments(workspaceId: string) {
  const { data, error } = await client().from("appointments").select("id, starts_at, status, reason, patient_id, doctor_id").eq("workspace_id", workspaceId).order("starts_at").limit(40);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createAppointment(input: { organizationId: string; workspaceId: string; patientId: string; doctorId: string | null; startsAt: string; reason: string; status?: string }) {
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

export async function saveConsultation(input: { organizationId: string; workspaceId: string; patientId: string; diagnosis: string; plan: string; medicine: string; dosage: string; followUpOn: string | null }) {
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
  if (input.medicine.trim()) {
    const { error: prescriptionError } = await client().from("prescriptions").insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      consultation_id: data.id,
      medicine: input.medicine,
      dosage: input.dosage,
    });
    if (prescriptionError) throw new Error(prescriptionError.message);
  }
}

export async function listProducts(workspaceId: string) {
  const { data, error } = await client().from("inventory_products").select("id, name, current_stock, minimum_stock, expires_on, unit").eq("workspace_id", workspaceId).order("name").limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createProduct(input: { organizationId: string; workspaceId: string; name: string; stock: number; minimum: number; category?: string; batch?: string; expiresOn?: string | null; purchasePrice?: number; sellingPrice?: number; supplier?: string }) {
  const { data, error } = await client().from("inventory_products").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    name: input.name,
    category: input.category ?? "",
    batch: input.batch ?? "",
    expires_on: input.expiresOn || null,
    purchase_price: input.purchasePrice ?? 0,
    selling_price: input.sellingPrice ?? 0,
    current_stock: 0,
    minimum_stock: input.minimum,
    supplier: input.supplier ?? "",
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (input.stock > 0) await changeStock(data.id as string, "purchase", input.stock);
}

export async function changeStock(productId: string, kind: "purchase" | "sale" | "adjustment" | "return" | "damaged" | "expired" | "treatment", quantity: number, note = "") {
  const signed = kind === "purchase" || kind === "return" ? Math.abs(quantity) : -Math.abs(quantity);
  const { error } = await client().rpc("apply_stock_change", { product: productId, kind, qty: signed, note });
  if (error) throw new Error(error.message);
}

export async function listStockMoves(workspaceId: string) {
  const { data, error } = await client().from("inventory_transactions").select("id, product_id, transaction_type, quantity, note, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createInvoice(input: { organizationId: string; workspaceId: string; patientId: string | null; description: string; quantity: number; unitPrice: number; discount: number }) {
  const total = invoiceTotal([{ quantity: input.quantity, unitPrice: input.unitPrice }], input.discount);
  const number = `INV-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await client().from("invoices").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    invoice_number: number,
    patient_id: input.patientId,
    discount: input.discount,
    total,
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

export async function createStudent(input: { organizationId: string; workspaceId: string; fullName: string; mobile: string; courseId: string | null; leadId?: string | null; batchName?: string; admissionDate?: string | null; status?: string }) {
  const code = `ST-${Date.now().toString(36).toUpperCase()}`;
  let batchId: string | null = null;
  if (input.batchName?.trim() && input.courseId) {
    const batch = await client().from("batches").insert({ organization_id: input.organizationId, workspace_id: input.workspaceId, course_id: input.courseId, name: input.batchName.trim() }).select("id").single();
    if (batch.error) throw new Error(batch.error.message);
    batchId = batch.data.id as string;
  }
  const { data, error } = await client().from("students").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId || null,
    student_code: code,
    full_name: input.fullName,
    mobile: input.mobile,
    course_id: input.courseId,
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
    course_id: input.courseId,
    batch_id: batchId,
    admitted_on: input.admissionDate || new Date().toISOString().slice(0, 10),
    status: input.status || "admitted",
  });
  if (admissionError) throw new Error(admissionError.message);
  return code;
}

export async function uploadPrivateFile(input: { organizationId: string; workspaceId: string; entityType: string; entityId: string; file: File; category: string }) {
  const checksum = await sha256(input.file);
  const { data: existing, error: existingError } = await client().from("documents").select("id, storage_path").eq("organization_id", input.organizationId).eq("checksum", checksum).limit(1);
  if (existingError) throw new Error(existingError.message);
  const optimized = input.category === "marketing" || input.category === "photo" ? await optimizeImage(input.file) : input.file;
  const path = existing?.[0]?.storage_path as string | undefined ?? `${input.organizationId}/${input.workspaceId}/${input.entityType}/${crypto.randomUUID()}-${optimized.name}`;
  if (!existing?.length) {
    const { error } = await client().storage.from("documents").upload(path, optimized, { contentType: optimized.type, upsert: false });
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

export async function signedDocumentUrl(path: string) {
  const { data, error } = await client().storage.from("documents").createSignedUrl(path, 60);
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

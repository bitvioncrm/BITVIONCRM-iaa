import { supabase } from "@/lib/supabase";

function db() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

export interface CareItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CareVisit {
  id: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  procedure1: string;
  procedure2: string;
  performedOn: string;
  notes: string;
  productTotal: number;
  items: CareItem[];
}

export interface LedgerRow {
  id: string;
  kind: "income" | "expense";
  amount: number;
  note: string;
  patientName: string;
  createdAt: string;
}

export async function listCareProducts(workspaceId: string) {
  const { data, error } = await db()
    .from("inventory_products")
    .select("id, name, current_stock, selling_price")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name")
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    stock: Number(row.current_stock ?? 0),
    price: Number(row.selling_price ?? 0),
  }));
}

export async function recordPatientCare(input: {
  patientId: string;
  doctorId: string | null;
  procedure1: string;
  procedure2: string;
  performedOn: string;
  notes: string;
  items: Array<{ productId: string; quantity: number }>;
}) {
  const { data, error } = await db().rpc("record_patient_care", {
    p_patient: input.patientId,
    p_doctor: input.doctorId,
    p_procedure_1: input.procedure1,
    p_procedure_2: input.procedure2,
    p_performed_on: input.performedOn || new Date().toISOString().slice(0, 10),
    p_notes: input.notes,
    p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
  });
  if (error) throw new Error(error.message);
  return String(data ?? "");
}

export async function listPatientCare(workspaceId: string) {
  const { data, error } = await db()
    .from("patient_procedures")
    .select("id, patient_id, doctor_id, procedure_1, procedure_2, performed_on, notes, product_total, patients(full_name), doctor:profiles!patient_procedures_doctor_id_fkey(full_name), patient_procedure_items(quantity, unit_price, line_total, inventory_products(name))")
    .eq("workspace_id", workspaceId)
    .order("performed_on", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const patient = row.patients as { full_name: string } | { full_name: string }[] | null;
    const doctor = row.doctor as { full_name: string } | { full_name: string }[] | null;
    const items = (row.patient_procedure_items as Array<Record<string, unknown>> | null) ?? [];
    return {
      id: String(row.id),
      patientId: String(row.patient_id),
      patientName: (Array.isArray(patient) ? patient[0]?.full_name : patient?.full_name) || "Patient",
      doctorName: (Array.isArray(doctor) ? doctor[0]?.full_name : doctor?.full_name) || "Doctor",
      procedure1: String(row.procedure_1 || ""),
      procedure2: String(row.procedure_2 || ""),
      performedOn: String(row.performed_on || ""),
      notes: String(row.notes || ""),
      productTotal: Number(row.product_total ?? 0),
      items: items.map((item) => {
        const product = item.inventory_products as { name: string } | { name: string }[] | null;
        return {
          productId: "",
          name: (Array.isArray(product) ? product[0]?.name : product?.name) || "Product",
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.unit_price ?? 0),
          lineTotal: Number(item.line_total ?? 0),
        };
      }),
    } satisfies CareVisit;
  });
}

export async function updatePatientDetails(input: { id: string; fullName: string; mobile: string; notes: string }) {
  const { error } = await db()
    .from("patients")
    .update({
      full_name: input.fullName.trim(),
      mobile: input.mobile.trim(),
      notes: input.notes.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
}

export async function listLedger(workspaceId: string) {
  const { data, error } = await db()
    .from("clinic_ledger")
    .select("id, kind, amount, note, created_at, patients(full_name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const patient = row.patients as { full_name: string } | { full_name: string }[] | null;
    return {
      id: String(row.id),
      kind: row.kind === "expense" ? "expense" : "income",
      amount: Number(row.amount ?? 0),
      note: String(row.note || ""),
      patientName: (Array.isArray(patient) ? patient[0]?.full_name : patient?.full_name) || "",
      createdAt: String(row.created_at || ""),
    } satisfies LedgerRow;
  });
}

export async function addLedgerEntry(input: {
  organizationId: string;
  workspaceId: string;
  patientId: string | null;
  kind: "income" | "expense";
  amount: number;
  note: string;
}) {
  const user = await db().auth.getUser();
  const { error } = await db().from("clinic_ledger").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    patient_id: input.patientId,
    kind: input.kind,
    amount: input.amount,
    note: input.note.trim(),
    source: "manual",
    created_by: user.data.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

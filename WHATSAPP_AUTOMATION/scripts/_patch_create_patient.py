from pathlib import Path

path = Path(r"D:\Bitvion Techzz\BITVION CRM\src\services\production-ops.ts")
text = path.read_text(encoding="utf-8")
start = text.index("export async function createPatient")
end = text.index("export async function updatePatient")
new = r'''export async function createPatient(input: { organizationId: string; workspaceId: string; fullName: string; mobile: string; place: string; email?: string; gender?: string; dateOfBirth?: string | null; address?: string; emergencyContact?: string; notes?: string; leadId?: string | null }) {
  forgetDeskLists();
  const { phoneKey } = await import("@/lib/lead-normalize");
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

'''
path.write_text(text[:start] + new + text[end:], encoding="utf-8")
print("patched ok", start, end)

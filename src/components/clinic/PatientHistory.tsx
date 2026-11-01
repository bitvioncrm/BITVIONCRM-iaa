import { useEffect, useState } from "react";
import { Portrait } from "@/components/shared/Portrait";
import { inr } from "@/lib/money";
import { listCareProducts, recordPatientCare } from "@/services/clinic-care";
import {
  clearDeskCache,
  loadPatientRecord,
  removeAppointment,
  removeConsultation,
  removePatient,
  removePatientProduct,
  removeProcedure,
  saveConsultation,
  savePersonPhoto,
  updateAppointment,
  updateConsultation,
  updatePatient,
  updateProcedure,
  type DeskAppointment,
  type DeskPatient,
  type PatientRecord,
  type PatientTreatment,
} from "@/services/production-ops";
import type { WorkspaceOption } from "@/services/production-leads";

type VisitEdit = {
  procedure1: string;
  procedure2: string;
  performedOn: string;
  notes: string;
  doctorId: string;
  diagnosis: string;
  plan: string;
  followUpOn: string;
  prescriptionId: string;
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
};

const field = "mt-1 h-11 w-full rounded-md border border-line bg-white px-3";

function editFrom(visit: PatientTreatment): VisitEdit {
  const medicine = visit.prescriptions[0];
  return {
    procedure1: visit.procedure1,
    procedure2: visit.procedure2,
    performedOn: visit.when.slice(0, 10),
    notes: visit.notes,
    doctorId: visit.doctorId,
    diagnosis: visit.diagnosis,
    plan: visit.plan,
    followUpOn: visit.followUpOn.slice(0, 10),
    prescriptionId: medicine?.id ?? "",
    medicine: medicine?.medicine ?? "",
    dosage: medicine?.dosage ?? "",
    frequency: medicine?.frequency ?? "",
    duration: medicine?.duration ?? "",
    instructions: medicine?.instructions ?? "",
  };
}

function whenLabel(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "Date not recorded";
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: value.includes("T") ? "numeric" : undefined, minute: value.includes("T") ? "2-digit" : undefined });
}

function doctorLabel(doctorId: string, doctors: Array<{ userId: string; name: string }>, currentUserId: string) {
  if (doctorId && doctorId === currentUserId) return "You";
  const row = doctors.find((item) => item.userId === doctorId);
  if (!row) return doctorId ? "Doctor" : "Doctor not recorded";
  const [person, role] = row.name.split(" · ");
  return person && person !== "Doctor" ? person : role || "Doctor";
}

export function PatientHistory({
  patient,
  workspace,
  doctors,
  currentUserId,
  onChanged,
  onDeleted,
  onNotice,
  onError,
  showDetails = true,
  showAppointments = true,
}: {
  patient: DeskPatient;
  workspace: WorkspaceOption;
  doctors: Array<{ userId: string; name: string }>;
  currentUserId: string;
  onChanged: (patient: DeskPatient) => void;
  onDeleted: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  showDetails?: boolean;
  showAppointments?: boolean;
}) {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [edits, setEdits] = useState<Record<string, VisitEdit>>({});
  const [profile, setProfile] = useState({ fullName: patient.full_name, mobile: patient.mobile, email: patient.email, gender: patient.gender || "other", dateOfBirth: patient.date_of_birth ?? "", place: patient.place, address: patient.address, emergency: patient.emergency_contact, notes: patient.notes });
  const [products, setProducts] = useState<Array<{ id: string; name: string; stock: number; price: number }>>([]);
  const [issueProduct, setIssueProduct] = useState("");
  const [issueQty, setIssueQty] = useState("1");
  const [procedure1, setProcedure1] = useState("");
  const [procedure2, setProcedure2] = useState("");
  const [consult, setConsult] = useState({ diagnosis: "", plan: "", medicine: "", dosage: "", frequency: "", duration: "", followUpOn: "" });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    clearDeskCache();
    const next = await loadPatientRecord(patient.id);
    setRecord(next);
    setEdits(Object.fromEntries(next.treatments.map((visit) => [visit.id, editFrom(visit)])));
    setProducts(await listCareProducts(workspace.id));
  };

  useEffect(() => {
    setProfile({ fullName: patient.full_name, mobile: patient.mobile, email: patient.email, gender: patient.gender || "other", dateOfBirth: patient.date_of_birth ?? "", place: patient.place, address: patient.address, emergency: patient.emergency_contact, notes: patient.notes });
    void reload().catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not open this history"));
  }, [patient.id, workspace.id]);

  const patchEdit = (id: string, patch: Partial<VisitEdit>) => setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  return (
    <div className="space-y-4">
      {showDetails ? (
      <>
      <div className="flex items-center gap-3">
        <Portrait name={patient.full_name} path={patient.photo_path} className="size-16 text-xl" />
        <div className="min-w-0">
          <p className="font-semibold">{patient.full_name}</p>
          <p className="text-xs text-muted">{patient.patient_code}</p>
          <label className="mt-1 inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-navy">
            Change photo
            <input type="file" accept="image/*" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void savePersonPhoto("patients", patient.id, workspace.organizationId, workspace.id, file)
                .then((path) => onChanged({ ...patient, photo_path: path }))
                .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the photo"));
            }} />
          </label>
        </div>
      </div>

      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void updatePatient(patient.id, {
          fullName: profile.fullName,
          mobile: profile.mobile,
          place: profile.place,
          email: profile.email,
          gender: profile.gender,
          dateOfBirth: profile.dateOfBirth || null,
          address: profile.address,
          emergencyContact: profile.emergency,
          notes: profile.notes,
        }).then(() => {
          onChanged({ ...patient, full_name: profile.fullName.trim(), mobile: profile.mobile.trim(), email: profile.email.trim(), gender: profile.gender, date_of_birth: profile.dateOfBirth || null, place: profile.place.trim(), address: profile.address.trim(), emergency_contact: profile.emergency.trim(), notes: profile.notes.trim() });
          onNotice("Patient saved.");
        }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the patient")).finally(() => setBusy(false));
      }}>
        <h3 className="text-sm font-semibold sm:col-span-2">Patient details</h3>
        <label className="text-sm sm:col-span-2">Name<input required value={profile.fullName} onChange={(event) => setProfile({ ...profile, fullName: event.target.value })} className={field} /></label>
        <label className="text-sm">Mobile<input value={profile.mobile} inputMode="tel" onChange={(event) => setProfile({ ...profile, mobile: event.target.value })} className={field} /></label>
        <label className="text-sm">Email<input type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} className={field} /></label>
        <label className="text-sm">Gender
          <select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value })} className={field}>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-sm">Date of birth<input type="date" value={profile.dateOfBirth} onChange={(event) => setProfile({ ...profile, dateOfBirth: event.target.value })} className={field} /></label>
        <label className="text-sm">Place<input value={profile.place} onChange={(event) => setProfile({ ...profile, place: event.target.value })} className={field} /></label>
        <label className="text-sm">Emergency contact<input value={profile.emergency} onChange={(event) => setProfile({ ...profile, emergency: event.target.value })} className={field} /></label>
        <label className="text-sm sm:col-span-2">Address<textarea value={profile.address} onChange={(event) => setProfile({ ...profile, address: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
        <label className="text-sm sm:col-span-2">Notes<textarea value={profile.notes} onChange={(event) => setProfile({ ...profile, notes: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white">{busy ? "Saving" : "Save patient"}</button>
          <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
            if (!window.confirm(`Delete ${patient.full_name}?`)) return;
            void removePatient(patient.id).then(onDeleted).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the patient"));
          }}>Delete</button>
        </div>
      </form>
      </>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Previous treatments</h3>
        {!record ? <p className="text-sm text-muted">Loading history…</p> : null}
        {record && record.treatments.length === 0 ? <p className="text-sm text-muted">No treatments recorded yet.</p> : null}
        {record?.treatments.map((visit) => {
          const edit = edits[visit.id] ?? editFrom(visit);
          return (
            <article key={visit.id} className="space-y-3 rounded-2xl border border-[#eadfca] bg-white p-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#8a6a2f] uppercase">{visit.kind === "consultation" ? "Consultation" : "Treatment"}</p>
                <p className="mt-1 text-sm font-medium">Taken {whenLabel(visit.when)} · {doctorLabel(visit.doctorId, doctors, currentUserId)}</p>
              </div>
              {visit.kind === "procedure" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">Treatment<input value={edit.procedure1} onChange={(event) => patchEdit(visit.id, { procedure1: event.target.value })} className={field} /></label>
                  <label className="text-sm">Second treatment<input value={edit.procedure2} onChange={(event) => patchEdit(visit.id, { procedure2: event.target.value })} className={field} /></label>
                  <label className="text-sm">Date taken<input type="date" value={edit.performedOn} onChange={(event) => patchEdit(visit.id, { performedOn: event.target.value })} className={field} /></label>
                  <label className="text-sm">Doctor
                    <select value={edit.doctorId} onChange={(event) => patchEdit(visit.id, { doctorId: event.target.value })} className={field}>
                      <option value="">Doctor not recorded</option>
                      {doctors.map((item) => <option key={item.userId} value={item.userId}>{doctorLabel(item.userId, doctors, currentUserId)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm sm:col-span-2">Notes<textarea value={edit.notes} onChange={(event) => patchEdit(visit.id, { notes: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
                  {visit.products.length > 0 ? (
                    <div className="space-y-2 sm:col-span-2">
                      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Products used</p>
                      {visit.products.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                          <span>{item.name} × {item.quantity} · {inr(item.amount)}</span>
                          {item.id ? <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                            void removePatientProduct(item.id).then(reload).then(() => { onNotice("Product removed. Stock is restored."); onChanged(patient); }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not remove the product"));
                          }}>Remove</button> : null}
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted sm:col-span-2">No products on this visit.</p>}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm sm:col-span-2">Diagnosis<input value={edit.diagnosis} onChange={(event) => patchEdit(visit.id, { diagnosis: event.target.value })} className={field} /></label>
                  <label className="text-sm sm:col-span-2">Treatment plan<textarea value={edit.plan} onChange={(event) => patchEdit(visit.id, { plan: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
                  <label className="text-sm">Medicine<input value={edit.medicine} onChange={(event) => patchEdit(visit.id, { medicine: event.target.value })} className={field} /></label>
                  <label className="text-sm">Dosage<input value={edit.dosage} onChange={(event) => patchEdit(visit.id, { dosage: event.target.value })} className={field} /></label>
                  <label className="text-sm">How often<input value={edit.frequency} onChange={(event) => patchEdit(visit.id, { frequency: event.target.value })} className={field} placeholder="Twice a day" /></label>
                  <label className="text-sm">How long<input value={edit.duration} onChange={(event) => patchEdit(visit.id, { duration: event.target.value })} className={field} placeholder="7 days" /></label>
                  <label className="text-sm sm:col-span-2">Instructions<textarea value={edit.instructions} onChange={(event) => patchEdit(visit.id, { instructions: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
                  <label className="text-sm">Follow-up date<input type="date" value={edit.followUpOn} onChange={(event) => patchEdit(visit.id, { followUpOn: event.target.value })} className={field} /></label>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-md bg-navy px-3 text-sm text-white" onClick={() => {
                  const run = visit.kind === "procedure"
                    ? updateProcedure(visit.id, { procedure1: edit.procedure1, procedure2: edit.procedure2, performedOn: edit.performedOn, notes: edit.notes, doctorId: edit.doctorId || null })
                    : updateConsultation(visit.id, { organizationId: workspace.organizationId, workspaceId: workspace.id, diagnosis: edit.diagnosis, plan: edit.plan, followUpOn: edit.followUpOn || null, prescriptionId: edit.prescriptionId, medicine: edit.medicine, dosage: edit.dosage, frequency: edit.frequency, duration: edit.duration, instructions: edit.instructions });
                  void run.then(reload).then(() => { onNotice("Visit saved."); onChanged(patient); }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save this visit"));
                }}>Save visit</button>
                <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                  if (!window.confirm("Delete this visit?")) return;
                  const run = visit.kind === "procedure" ? removeProcedure(visit.id) : removeConsultation(visit.id);
                  void run.then(reload).then(() => { onNotice("Visit deleted."); onChanged(patient); }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete this visit"));
                }}>Delete visit</button>
              </div>
            </article>
          );
        })}
      </section>

      <form className="grid gap-3 rounded-2xl border border-line bg-white p-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const count = Number(issueQty);
        if (!procedure1.trim() && !issueProduct) return;
        setBusy(true);
        void recordPatientCare({
          patientId: patient.id,
          doctorId: currentUserId || null,
          procedure1,
          procedure2,
          performedOn: new Date().toISOString().slice(0, 10),
          notes: "",
          items: issueProduct && count > 0 ? [{ productId: issueProduct, quantity: count }] : [],
        }).then(reload).then(() => {
          setProcedure1("");
          setProcedure2("");
          setIssueQty("1");
          onNotice("Treatment saved. Stock is reduced for any product used.");
          onChanged(patient);
          window.dispatchEvent(new CustomEvent("bitvion-stock"));
        }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the treatment")).finally(() => setBusy(false));
      }}>
        <h3 className="text-sm font-semibold sm:col-span-2">Add a treatment</h3>
        <label className="text-sm">Treatment<input value={procedure1} onChange={(event) => setProcedure1(event.target.value)} className={field} /></label>
        <label className="text-sm">Second treatment<input value={procedure2} onChange={(event) => setProcedure2(event.target.value)} className={field} /></label>
        <label className="text-sm sm:col-span-2">Product used
          <select value={issueProduct} onChange={(event) => setIssueProduct(event.target.value)} className={field}>
            <option value="">No product</option>
            {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stock} in stock · {inr(item.price)}</option>)}
          </select>
        </label>
        <label className="text-sm">Quantity<input inputMode="numeric" value={issueQty} onChange={(event) => setIssueQty(event.target.value)} className={field} /></label>
        <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:self-end">{busy ? "Saving" : "Save treatment and reduce stock"}</button>
      </form>

      <form className="grid gap-3 rounded-2xl border border-line bg-white p-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void saveConsultation({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          patientId: patient.id,
          diagnosis: consult.diagnosis,
          plan: consult.plan,
          medicine: consult.medicine,
          dosage: consult.dosage,
          frequency: consult.frequency,
          duration: consult.duration,
          followUpOn: consult.followUpOn || null,
        }).then(reload).then(() => {
          setConsult({ diagnosis: "", plan: "", medicine: "", dosage: "", frequency: "", duration: "", followUpOn: "" });
          onNotice("Consultation saved.");
          onChanged(patient);
        }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the consultation")).finally(() => setBusy(false));
      }}>
        <h3 className="text-sm font-semibold sm:col-span-2">Add a consultation</h3>
        <label className="text-sm sm:col-span-2">Diagnosis<input value={consult.diagnosis} onChange={(event) => setConsult({ ...consult, diagnosis: event.target.value })} className={field} /></label>
        <label className="text-sm sm:col-span-2">Treatment plan<textarea value={consult.plan} onChange={(event) => setConsult({ ...consult, plan: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
        <label className="text-sm">Medicine<input value={consult.medicine} onChange={(event) => setConsult({ ...consult, medicine: event.target.value })} className={field} /></label>
        <label className="text-sm">Dosage<input value={consult.dosage} onChange={(event) => setConsult({ ...consult, dosage: event.target.value })} className={field} /></label>
        <label className="text-sm">How often<input value={consult.frequency} onChange={(event) => setConsult({ ...consult, frequency: event.target.value })} className={field} placeholder="Twice a day" /></label>
        <label className="text-sm">How long<input value={consult.duration} onChange={(event) => setConsult({ ...consult, duration: event.target.value })} className={field} placeholder="7 days" /></label>
        <label className="text-sm">Follow-up date<input type="date" value={consult.followUpOn} onChange={(event) => setConsult({ ...consult, followUpOn: event.target.value })} className={field} /></label>
        <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:self-end">{busy ? "Saving" : "Save consultation"}</button>
      </form>

      {showAppointments ? (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Appointments</h3>
        {patient.appointments.length === 0 ? <p className="text-sm text-muted">No appointments yet.</p> : patient.appointments.map((item) => (
          <AppointmentRow key={item.id} item={item} onSaved={async (message) => { onNotice(message); onChanged(patient); }} onError={onError} />
        ))}
      </section>
      ) : null}

      {record && record.bills.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Bills</h3>
          {record.bills.map((bill) => (
            <article key={bill.id} className="rounded-2xl border border-line bg-white px-3 py-3 text-sm">
              <p className="font-medium">{bill.number || "Invoice"} · {bill.issuedOn}</p>
              <p className="mt-1">Total {inr(bill.total)} · Paid {inr(bill.paid)} · Balance {inr(bill.balance)}</p>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function AppointmentRow({ item, onSaved, onError }: { item: DeskAppointment; onSaved: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const [when, setWhen] = useState(() => localInput(item.starts_at));
  const [reason, setReason] = useState(item.reason);
  return (
    <div className="grid gap-2 rounded-2xl border border-line bg-white p-3">
      <label className="text-sm">Appointment
        <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className={field} />
      </label>
      <label className="text-sm">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} className={field} /></label>
      <label className="text-sm">Status
        <select value={item.status} onChange={(event) => {
          void updateAppointment(item.id, { status: event.target.value }).then(() => onSaved("Appointment updated.")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the appointment"));
        }} className={field}>
          {["scheduled", "confirmed", "arrived", "in_consultation", "completed", "cancelled", "no_show"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-md bg-navy px-3 text-sm text-white" onClick={() => {
          void updateAppointment(item.id, { startsAt: new Date(when).toISOString(), reason }).then(() => onSaved("Appointment saved.")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the appointment"));
        }}>Save appointment</button>
        <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
          if (!window.confirm("Delete this appointment?")) return;
          void removeAppointment(item.id).then(() => onSaved("Appointment deleted.")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the appointment"));
        }}>Delete</button>
      </div>
    </div>
  );
}

function localInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

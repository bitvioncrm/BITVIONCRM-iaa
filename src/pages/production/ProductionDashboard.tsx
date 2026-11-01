import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BusinessBoard } from "@/components/dashboard/BusinessBoard";
import { StudentFile } from "@/components/institute/StudentFile";
import { detailsFromStudent, StudentForm } from "@/components/institute/StudentForm";
import { Portrait } from "@/components/shared/Portrait";
import { Sheet, SheetBody, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useDesk } from "@/context/DeskContext";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { loadDoctorPulse } from "@/services/clinic-care";
import { formatClock } from "@/lib/call-time";
import { phoneTel } from "@/lib/phone";
import { rangeBounds, type RangeKey } from "@/lib/range";
import { callDeskReport, countRows, listDeskMoney, listDeskPatients, listDeskStudents, listFollowUps, clearDeskCache, loadPatientRecord, removeAppointment, removePatient, removePatientProduct, removeStudent, savePersonPhoto, saveStudentDetails, updateAppointment, updatePatient, type DeskMoney, type DeskPatient, type DeskStudent, type PatientRecord, type PatientTreatment, type StudentDetails } from "@/services/production-ops";
import { listCareProducts, recordPatientCare } from "@/services/clinic-care";
import { listDoctors } from "@/services/production-leads";
import { inr } from "@/lib/money";

function Stat({ label, value, hint, active, onClick }: { label: string; value: string; hint?: string; active?: boolean; onClick?: () => void }) {
  const className = `min-h-20 rounded-2xl border px-4 py-3 text-left ${active ? "border-[#c6a15b] bg-[#faf6ee]" : "border-line bg-white"}`;
  const body = (
    <>
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </>
  );
  if (!onClick) return <div className={className}>{body}</div>;
  return <button type="button" onClick={onClick} className={`${className} w-full`}>{body}</button>;
}

function Tile({ to, label }: { to: string; label: string }) {
  return <Link className="rounded-md border border-line bg-white px-3 py-2 text-sm hover:border-navy" to={to}>{label}</Link>;
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function ProductionDashboard() {
  const { productionUser } = useAuth();
  const key = productionUser?.roleKey ?? "";
  if (key === "doctor" || key === "duty_doctor") return <DoctorDashboard />;
  if (key === "receptionist") return <ReceptionDashboard />;
  if (key === "clinic_telecaller" || key === "clinic_bde") return <ClinicCallerDashboard />;
  if (key === "institute_telecaller" || key === "institute_bde" || key === "institute_user") return <InstituteCallerDashboard />;
  return <AdminDashboard />;
}

function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void listWorkspaces().then(setWorkspaces).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);
  return { workspaces, error };
}

function AdminDashboard() {
  const { desk } = useDesk();
  return <BusinessBoard desk={desk} />;
}

function DoctorDashboard() {
  const { productionUser } = useAuth();
  const { workspaces, error } = useWorkspaces();
  const clinic = workspaces.find((item) => item.workspaceType === "clinic") ?? workspaces[0];
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [pulse, setPulse] = useState({ consulted: 0, patients: 0, pending: 0, units: 0, days: [] as Array<{ day: string; sold: number }> });
  const [cards, setCards] = useState<DeskPatient[]>([]);
  const [open, setOpen] = useState<DeskPatient | null>(null);
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [doctors, setDoctors] = useState<Array<{ userId: string; name: string }>>([]);
  const [careProducts, setCareProducts] = useState<Array<{ id: string; name: string; stock: number; price: number }>>([]);
  const [issueProduct, setIssueProduct] = useState("");
  const [issueQty, setIssueQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [edit, setEdit] = useState({ fullName: "", mobile: "", email: "", gender: "other", dateOfBirth: "", place: "", address: "", emergency: "", notes: "" });
  const reloadPulse = () => {
    if (!clinic) return;
    const bounds = rangeBounds(range, customFrom, customTo);
    void loadDoctorPulse(clinic.id, bounds.fromDate, bounds.toDate, bounds.from, bounds.to).then(setPulse).catch(() => setPulse({ consulted: 0, patients: 0, pending: 0, units: 0, days: [] }));
  };
  useEffect(() => {
    if (!clinic) return;
    reloadPulse();
    void listDeskPatients(clinic.id).then(setCards).catch(() => setCards([]));
    void listDoctors(clinic.id).then(setDoctors).catch(() => setDoctors([]));
    void listCareProducts(clinic.id).then(setCareProducts).catch(() => setCareProducts([]));
  }, [clinic, range, customFrom, customTo]);
  useEffect(() => {
    if (!open) return;
    setEdit({
      fullName: open.full_name,
      mobile: open.mobile,
      email: open.email,
      gender: open.gender || "other",
      dateOfBirth: open.date_of_birth ?? "",
      place: open.place,
      address: open.address,
      emergency: open.emergency_contact,
      notes: open.notes,
    });
    setRecord(null);
    setFormError("");
    void loadPatientRecord(open.id).then(setRecord).catch((reason: unknown) => setFormError(reason instanceof Error ? reason.message : "Could not open this patient"));
  }, [open?.id]);
  return (
    <Shell title="Doctor">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {([["today", "Today"], ["7d", "Weekly"], ["this_month", "Monthly"], ["this_year", "Yearly"], ["custom", "Custom"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`min-h-11 rounded-md border px-3 py-2 text-sm ${range === key ? "border-navy bg-navy text-white" : "border-line bg-white"}`} onClick={() => setRange(key)}>{label}</button>
        ))}
        {range === "custom" ? (
          <>
            <input type="date" className="rounded-md border border-line px-2 py-2" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            <input type="date" className="rounded-md border border-line px-2 py-2" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          </>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total consulted" value={String(pulse.consulted)} />
        <Stat label="Patients consulted" value={String(pulse.patients)} />
        <Stat label="Pending" value={String(pulse.pending)} />
        <Stat label="Products sold" value={String(pulse.units)} />
      </div>
      <div className="flex flex-wrap gap-2"><Tile to="/clinic" label="Patients and consultations" /><Tile to="/inventory" label="Stock" /></div>
      <section>
        <h2 className="text-sm font-semibold">Patients</h2>
        {cards.length === 0 ? <p className="mt-2 text-sm text-muted">No patients registered yet.</p> : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((patient) => (
              <button key={patient.id} type="button" onClick={() => { setNote(""); setOpen(patient); }} className="touch-card flex gap-3 rounded-2xl border border-line bg-white p-3 text-left hover:border-[#c6a15b]">
                <Portrait name={patient.full_name} path={patient.photo_path} />
                <span className="min-w-0">
                  <span className="block font-medium">{patient.full_name}</span>
                  <span className="mt-1 block text-xs text-muted">{patient.patient_code} · {patient.mobile || "No mobile"}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Products sold per day</h2>
        {pulse.days.length === 0 ? <p className="mt-2 text-sm text-muted">No products sold in this range.</p> : pulse.days.map((row) => (
          <p key={row.day} className="mt-2 text-sm">{row.day} · {row.sold} sold</p>
        ))}
      </section>
      <Sheet open={Boolean(open)} onOpenChange={(next) => { if (!next) setOpen(null); }}>
        {open ? (
          <SheetContent title={open.full_name}>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <Portrait name={open.full_name} path={open.photo_path} />
                <div>
                  <p className="font-semibold">{open.full_name}</p>
                  <p className="text-xs text-muted">{open.patient_code}</p>
                </div>
              </div>
            </SheetHeader>
            <SheetBody className="space-y-4">
              {note ? <p className="text-sm text-emerald-700">{note}</p> : null}
              {formError ? <p className="text-sm text-danger">{formError}</p> : null}
              <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void updatePatient(open.id, {
                  fullName: edit.fullName,
                  mobile: edit.mobile,
                  place: edit.place,
                  email: edit.email,
                  gender: edit.gender,
                  dateOfBirth: edit.dateOfBirth || null,
                  address: edit.address,
                  emergencyContact: edit.emergency,
                  notes: edit.notes,
                }).then(() => {
                  const next = { ...open, full_name: edit.fullName.trim(), mobile: edit.mobile.trim(), email: edit.email.trim(), gender: edit.gender, date_of_birth: edit.dateOfBirth || null, place: edit.place.trim(), address: edit.address.trim(), emergency_contact: edit.emergency.trim(), notes: edit.notes.trim() };
                  setCards((current) => current.map((item) => item.id === open.id ? next : item));
                  setOpen(next);
                  setNote("Patient saved.");
                }).catch((reason: unknown) => setFormError(reason instanceof Error ? reason.message : "Could not save the patient")).finally(() => setBusy(false));
              }}>
                <label className="text-sm sm:col-span-2">Name<input required value={edit.fullName} onChange={(event) => setEdit({ ...edit, fullName: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Mobile<input value={edit.mobile} inputMode="tel" onChange={(event) => setEdit({ ...edit, mobile: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Email<input type="email" value={edit.email} onChange={(event) => setEdit({ ...edit, email: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Gender
                  <select value={edit.gender} onChange={(event) => setEdit({ ...edit, gender: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3">
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="text-sm">Date of birth<input type="date" value={edit.dateOfBirth} onChange={(event) => setEdit({ ...edit, dateOfBirth: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Place<input value={edit.place} onChange={(event) => setEdit({ ...edit, place: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Emergency contact<input value={edit.emergency} onChange={(event) => setEdit({ ...edit, emergency: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm sm:col-span-2">Address<textarea value={edit.address} onChange={(event) => setEdit({ ...edit, address: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
                <label className="text-sm sm:col-span-2">Notes<textarea value={edit.notes} onChange={(event) => setEdit({ ...edit, notes: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
                <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:col-span-2">{busy ? "Saving" : "Save patient"}</button>
              </form>
              <form className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2" onSubmit={(event) => {
                event.preventDefault();
                const count = Number(issueQty);
                if (!issueProduct || count <= 0) return;
                setBusy(true);
                void recordPatientCare({
                  patientId: open.id,
                  doctorId: productionUser?.userId || null,
                  procedure1: "Products",
                  procedure2: "",
                  performedOn: new Date().toISOString().slice(0, 10),
                  notes: "",
                  items: [{ productId: issueProduct, quantity: count }],
                }).then(async () => {
                  clearDeskCache();
                  const [nextRecord, nextCards] = await Promise.all([loadPatientRecord(open.id), clinic ? listDeskPatients(clinic.id) : Promise.resolve(null)]);
                  setRecord(nextRecord);
                  if (nextCards) setCards(nextCards);
                  setCareProducts((current) => current.map((item) => item.id === issueProduct ? { ...item, stock: Math.max(0, item.stock - count) } : item));
                  setIssueQty("1");
                  setNote("Product added. Stock is reduced.");
                  reloadPulse();
                  window.dispatchEvent(new CustomEvent("bitvion-stock"));
                }).catch((reason: unknown) => setFormError(reason instanceof Error ? reason.message : "Could not add the product")).finally(() => setBusy(false));
              }}>
                <h3 className="text-sm font-semibold sm:col-span-2">Add a product</h3>
                <label className="text-sm sm:col-span-2">Product
                  <select required value={issueProduct} onChange={(event) => setIssueProduct(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
                    <option value="">Choose a product</option>
                    {careProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stock} in stock · {inr(item.price)}</option>)}
                  </select>
                </label>
                <label className="text-sm">Quantity<input inputMode="numeric" value={issueQty} onChange={(event) => setIssueQty(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:self-end">{busy ? "Saving" : "Add product and reduce stock"}</button>
              </form>
              {record ? <PatientFile record={record} doctors={doctors} onRemoveProduct={(itemId) => {
                void removePatientProduct(itemId).then(async () => {
                  clearDeskCache();
                  setRecord(await loadPatientRecord(open.id));
                  if (clinic) setCareProducts(await listCareProducts(clinic.id));
                  setNote("Product removed. Stock is restored.");
                  reloadPulse();
                  window.dispatchEvent(new CustomEvent("bitvion-stock"));
                }).catch((reason: unknown) => setFormError(reason instanceof Error ? reason.message : "Could not remove the product"));
              }} /> : <p className="text-sm text-muted">Loading treatments and products…</p>}
            </SheetBody>
          </SheetContent>
        ) : null}
      </Sheet>
    </Shell>
  );
}

function ReceptionDashboard() {
  const { workspaces, error } = useWorkspaces();
  const clinic = workspaces.find((item) => item.workspaceType === "clinic") ?? workspaces[0];
  const [cards, setCards] = useState<DeskPatient[]>([]);
  const [money, setMoney] = useState<DeskMoney[]>([]);
  const [filter, setFilter] = useState<DeskFilter>("all");
  const [focus, setFocus] = useState<"patients" | "appointments" | "arrived">("patients");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [open, setOpen] = useState<DeskPatient | null>(null);
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [recordError, setRecordError] = useState("");
  const [doctors, setDoctors] = useState<Array<{ userId: string; name: string }>>([]);
  const [careProducts, setCareProducts] = useState<Array<{ id: string; name: string; stock: number; price: number }>>([]);
  const [issueProduct, setIssueProduct] = useState("");
  const [issueQty, setIssueQty] = useState("1");
  const [issueDoctor, setIssueDoctor] = useState("");
  const [cardBusy, setCardBusy] = useState(false);
  const [cardNote, setCardNote] = useState("");
  const [patientEdit, setPatientEdit] = useState({ fullName: "", mobile: "", email: "", gender: "other", dateOfBirth: "", place: "", address: "", emergency: "", notes: "" });
  useEffect(() => {
    if (!clinic) return;
    void listDoctors(clinic.id).then(setDoctors).catch(() => setDoctors([]));
    void listCareProducts(clinic.id).then(setCareProducts).catch(() => setCareProducts([]));
  }, [clinic]);
  useEffect(() => {
    if (!open) return;
    const patientId = open.id;
    setPatientEdit({
      fullName: open.full_name,
      mobile: open.mobile,
      email: open.email,
      gender: open.gender || "other",
      dateOfBirth: open.date_of_birth || "",
      place: open.place,
      address: open.address,
      emergency: open.emergency_contact,
      notes: open.notes,
    });
    let active = true;
    setRecord(null);
    setRecordError("");
    void loadPatientRecord(patientId)
      .then((row) => { if (active) setRecord(row); })
      .catch((reason: unknown) => { if (active) setRecordError(reason instanceof Error ? reason.message : "Could not load this patient"); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => {
    if (!clinic) return;
    void listDeskPatients(clinic.id).then(setCards).catch(() => setCards([]));
    void listDeskMoney(clinic.id).then(setMoney).catch(() => setMoney([]));
  }, [clinic]);
  const span = useMemo(() => boundsFor(filter, customFrom, customTo), [filter, customFrom, customTo]);
  const moneyInRange = useMemo(() => money.filter((row) => filter === "all" || inside(moneyStamp(row.at), span.from, span.to)), [filter, money, span.from, span.to]);
  const income = moneyInRange.filter((row) => row.kind === "income").reduce((sum, row) => sum + row.amount, 0);
  const expense = moneyInRange.filter((row) => row.kind === "expense").reduce((sum, row) => sum + row.amount, 0);
  const moneyDays = useMemo(() => {
    const grouped = new Map<string, { income: number; expense: number }>();
    for (const row of moneyInRange) {
      const key = dayKey(row.at);
      const current = grouped.get(key) ?? { income: 0, expense: 0 };
      current[row.kind] += row.amount;
      grouped.set(key, current);
    }
    return [...grouped.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [moneyInRange]);
  const patientTotal = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of money) {
      if (!row.patientId || row.kind !== "income") continue;
      totals.set(row.patientId, (totals.get(row.patientId) ?? 0) + row.amount);
    }
    return totals;
  }, [money]);
  const visible = useMemo(() => cards.filter((patient) => patientMatches(patient, filter, customFrom, customTo)), [cards, filter, customFrom, customTo]);
  const withAppointments = useMemo(() => cards.filter((patient) => rangedAppointments(patient, filter, customFrom, customTo).length > 0), [cards, filter, customFrom, customTo]);
  const arrivedPatients = useMemo(() => cards.filter((patient) => rangedAppointments(patient, filter, customFrom, customTo).some((item) => item.status === "arrived")), [cards, filter, customFrom, customTo]);
  const appointmentCount = useMemo(() => cards.reduce((sum, patient) => sum + rangedAppointments(patient, filter, customFrom, customTo).length, 0), [cards, filter, customFrom, customTo]);
  const arrivedCount = useMemo(() => cards.reduce((sum, patient) => sum + rangedAppointments(patient, filter, customFrom, customTo).filter((item) => item.status === "arrived").length, 0), [cards, filter, customFrom, customTo]);
  const shown = focus === "appointments" ? withAppointments : focus === "arrived" ? arrivedPatients : visible;
  const shownLabel = focus === "appointments" ? "patients with appointments" : focus === "arrived" ? "arrived patients" : "patients";
  const choose = (next: "patients" | "appointments" | "arrived") => {
    setFocus(next);
    document.getElementById("reception-cards")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Shell title="Reception">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Patients" value={String(visible.length)} hint="Open the cards" active={focus === "patients"} onClick={() => choose("patients")} />
        <Stat label="Appointments" value={String(appointmentCount)} hint={`${withAppointments.length} patients`} active={focus === "appointments"} onClick={() => choose("appointments")} />
        <Stat label="Arrived" value={String(arrivedCount)} hint={`${arrivedPatients.length} patients`} active={focus === "arrived"} onClick={() => choose("arrived")} />
        <Stat label="Income" value={inr(income)} />
        <Stat label="Expense" value={inr(expense)} />
        <Stat label="Total" value={inr(income - expense)} />
      </div>
      <div className="flex flex-wrap gap-2"><Tile to="/appointments" label="Appointments" /><Tile to="/clinic" label="Register and appointments" /><Tile to="/billing" label="Income and expenses" /><Tile to="/inventory" label="Stock" /></div>
      <FilterBar filter={filter} customFrom={customFrom} customTo={customTo} onFilter={setFilter} onFrom={setCustomFrom} onTo={setCustomTo} count={shown.length} noun={shownLabel} />
      <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
        <h2 className="text-sm font-semibold">Income and expenses</h2>
        {moneyDays.length === 0 ? <p className="mt-2 text-sm text-muted">No income or expenses in this range.</p> : (
          <div className="mt-3 space-y-2">
            {moneyDays.map(([day, row]) => (
              <div key={day} className="flex flex-col gap-1 rounded-xl border border-line px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{formatWhen(day)}</span>
                <span className="text-muted">Income {inr(row.income)} · Expense {inr(row.expense)} · Total {inr(row.income - row.expense)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div id="reception-cards">
      {shown.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No patients in this range.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((patient) => {
            const visits = [...patient.appointments].sort((left, right) => left.starts_at.localeCompare(right.starts_at));
            const first = patient.treatments[0];
            const latest = visits[visits.length - 1];
            return (
              <div key={patient.id} className="touch-card rounded-2xl border border-line bg-white p-4 text-left shadow-sm sm:transition sm:hover:-translate-y-0.5 sm:hover:border-[#c6a15b] sm:hover:shadow-md">
              <button type="button" onClick={() => setOpen(patient)} className="w-full text-left">
                <div className="flex items-start gap-3">
                  <Portrait name={patient.full_name} path={patient.photo_path} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-lg font-semibold text-ink">{patient.full_name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{patient.patient_code}</span>
                  </span>
                  {latest ? <StatusChip status={latest.status} /> : null}
                </div>
                <p className="mt-3 text-sm text-ink">{patient.mobile || "No mobile"}{patient.place ? ` · ${patient.place}` : ""}</p>
                <p className="mt-1 text-xs text-muted">{[patient.gender, patient.age == null ? "" : `Age ${patient.age}`, patient.address].filter(Boolean).join(" · ")}</p>
                <p className="mt-3 text-sm"><span className="font-medium">First treatment </span>{first ? `${formatWhen(first.performed_on)} · ${first.title}` : "Not recorded yet"}</p>
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">Every visit</p>
                  {visits.length === 0 ? <p className="text-sm text-muted">No visits yet.</p> : visits.map((item) => (
                    <p key={item.id} className="text-sm">{formatWhen(item.starts_at)}{item.reason ? ` · ${item.reason}` : ""} · {item.status.replaceAll("_", " ")}</p>
                  ))}
                </div>
                <p className="mt-3 text-sm font-semibold">Total {inr(patientTotal.get(patient.id) ?? 0)}</p>
              </button>
              {phoneTel(patient.mobile) ? <a href={phoneTel(patient.mobile)} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-navy">Call</a> : null}
              </div>
            );
          })}
        </div>
      )}
      </div>
      <Sheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpen(null); }}>
        {open ? (
          <SheetContent title={open.full_name}>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <Portrait name={open.full_name} path={open.photo_path} className="size-16 text-xl" />
                <div>
                  <p className="text-xs font-medium tracking-wide text-[#a6843d] uppercase">{open.patient_code}</p>
                  <h2 className="mt-1 text-xl font-semibold">{open.full_name}</h2>
                </div>
              </div>
              <p className="mt-1 text-sm text-muted">{open.mobile || "No mobile"}{open.place ? ` · ${open.place}` : ""}</p>
            </SheetHeader>
            <SheetBody className="space-y-4">
              {clinic ? (
                <label className="inline-flex cursor-pointer rounded-full border border-line px-3 py-1.5 text-sm">
                  Change photo
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void savePersonPhoto("patients", open.id, clinic.organizationId, clinic.id, file)
                      .then((path) => {
                        setCards((current) => current.map((item) => item.id === open.id ? { ...item, photo_path: path } : item));
                        setOpen({ ...open, photo_path: path });
                      })
                      .catch(() => undefined);
                  }} />
                </label>
              ) : null}
              <p className="text-sm text-muted">Registered {formatWhen(open.created_at)} · Total {inr(patientTotal.get(open.id) ?? 0)}{open.treatments[0] ? ` · First treatment ${formatWhen(open.treatments[0].performed_on)}` : ""}</p>
              {cardNote ? <p className="text-sm text-emerald-700">{cardNote}</p> : null}
              <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => {
                event.preventDefault();
                if (!clinic) return;
                setCardBusy(true);
                const next = {
                  ...open,
                  full_name: patientEdit.fullName.trim(),
                  mobile: patientEdit.mobile.trim(),
                  email: patientEdit.email.trim(),
                  gender: patientEdit.gender,
                  date_of_birth: patientEdit.dateOfBirth || null,
                  age: patientEdit.dateOfBirth ? Math.max(0, new Date().getFullYear() - new Date(patientEdit.dateOfBirth).getFullYear()) : open.age,
                  place: patientEdit.place.trim(),
                  address: patientEdit.address.trim(),
                  emergency_contact: patientEdit.emergency.trim(),
                  notes: patientEdit.notes.trim(),
                };
                void updatePatient(open.id, {
                  fullName: patientEdit.fullName,
                  mobile: patientEdit.mobile,
                  place: patientEdit.place,
                  email: patientEdit.email,
                  gender: patientEdit.gender,
                  dateOfBirth: patientEdit.dateOfBirth || null,
                  address: patientEdit.address,
                  emergencyContact: patientEdit.emergency,
                  notes: patientEdit.notes,
                }).then(() => {
                  setCards((current) => current.map((item) => item.id === open.id ? next : item));
                  setOpen(next);
                  setCardNote("Patient saved.");
                }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not save the patient")).finally(() => setCardBusy(false));
              }}>
                <label className="text-sm sm:col-span-2">Name<input required value={patientEdit.fullName} onChange={(event) => setPatientEdit({ ...patientEdit, fullName: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Mobile<input value={patientEdit.mobile} inputMode="tel" onChange={(event) => setPatientEdit({ ...patientEdit, mobile: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Email<input type="email" value={patientEdit.email} onChange={(event) => setPatientEdit({ ...patientEdit, email: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Gender
                  <select value={patientEdit.gender} onChange={(event) => setPatientEdit({ ...patientEdit, gender: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3">
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="text-sm">Date of birth<input type="date" value={patientEdit.dateOfBirth} onChange={(event) => setPatientEdit({ ...patientEdit, dateOfBirth: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Place<input value={patientEdit.place} onChange={(event) => setPatientEdit({ ...patientEdit, place: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Emergency contact<input value={patientEdit.emergency} onChange={(event) => setPatientEdit({ ...patientEdit, emergency: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm sm:col-span-2">Address<textarea value={patientEdit.address} onChange={(event) => setPatientEdit({ ...patientEdit, address: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
                <label className="text-sm sm:col-span-2">Notes<textarea value={patientEdit.notes} onChange={(event) => setPatientEdit({ ...patientEdit, notes: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button type="submit" disabled={cardBusy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white">{cardBusy ? "Saving" : "Save patient"}</button>
                  <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                    if (!window.confirm(`Delete ${open.full_name}?`)) return;
                    void removePatient(open.id).then(() => {
                      setCards((current) => current.filter((item) => item.id !== open.id));
                      setOpen(null);
                    }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not delete the patient"));
                  }}>Delete</button>
                </div>
              </form>
              <form className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2" onSubmit={(event) => {
                event.preventDefault();
                const count = Number(issueQty);
                if (!issueProduct || count <= 0) return;
                setCardBusy(true);
                void recordPatientCare({
                  patientId: open.id,
                  doctorId: issueDoctor || null,
                  procedure1: "Products",
                  procedure2: "",
                  performedOn: new Date().toISOString().slice(0, 10),
                  notes: "",
                  items: [{ productId: issueProduct, quantity: count }],
                }).then(async () => {
                  clearDeskCache();
                  const [nextRecord, nextCards] = await Promise.all([loadPatientRecord(open.id), clinic ? listDeskPatients(clinic.id) : Promise.resolve(null)]);
                  setRecord(nextRecord);
                  if (nextCards) setCards(nextCards);
                  setCareProducts((current) => current.map((item) => item.id === issueProduct ? { ...item, stock: Math.max(0, item.stock - count) } : item));
                  setIssueQty("1");
                  setCardNote("Product added. Stock is reduced.");
                  window.dispatchEvent(new CustomEvent("bitvion-stock"));
                }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not add the product")).finally(() => setCardBusy(false));
              }}>
                <h3 className="text-sm font-semibold sm:col-span-2">Add a product</h3>
                <label className="text-sm sm:col-span-2">Product
                  <select required value={issueProduct} onChange={(event) => setIssueProduct(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
                    <option value="">Choose a product</option>
                    {careProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stock} in stock · {inr(item.price)}</option>)}
                  </select>
                </label>
                <label className="text-sm">Quantity<input inputMode="numeric" value={issueQty} onChange={(event) => setIssueQty(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Doctor
                  <select value={issueDoctor} onChange={(event) => setIssueDoctor(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
                    <option value="">No doctor yet</option>
                    {doctors.map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={cardBusy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:col-span-2">{cardBusy ? "Saving" : "Add product and reduce stock"}</button>
              </form>
              <div>
                <h3 className="text-sm font-semibold">Bookings</h3>
                {open.appointments.length === 0 ? <p className="mt-2 text-sm text-muted">No appointments yet.</p> : open.appointments.map((item) => (
                  <div key={item.id} className="mt-2 space-y-2 rounded-xl border border-line px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">{formatWhen(item.starts_at)}{item.reason ? ` · ${item.reason}` : ""}{item.doctor_id ? ` · ${doctorName(item.doctor_id, doctors)}` : ""}</span>
                      <StatusChip status={item.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={item.status} onChange={(event) => {
                        const status = event.target.value;
                        void updateAppointment(item.id, { status }).then(() => {
                          const next = { ...open, appointments: open.appointments.map((row) => row.id === item.id ? { ...row, status } : row) };
                          setOpen(next);
                          setCards((current) => current.map((patient) => patient.id === open.id ? next : patient));
                        }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not update the appointment"));
                      }} className="h-11 rounded-md border border-line px-2 capitalize">
                        {["scheduled", "confirmed", "arrived", "in_consultation", "completed", "cancelled", "no_show"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                      </select>
                      <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                        if (!window.confirm("Delete this appointment?")) return;
                        void removeAppointment(item.id).then(() => {
                          const next = { ...open, appointments: open.appointments.filter((row) => row.id !== item.id) };
                          setOpen(next);
                          setCards((current) => current.map((patient) => patient.id === open.id ? next : patient));
                        }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not delete the appointment"));
                      }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
              {recordError ? <p className="text-sm text-danger">{recordError}</p> : null}
              {!record && !recordError ? <p className="text-sm text-muted">Loading treatments and products…</p> : null}
              {record ? <PatientFile record={record} doctors={doctors} onRemoveProduct={(itemId) => {
                void removePatientProduct(itemId).then(async () => {
                  setRecord(await loadPatientRecord(open.id));
                  if (clinic) setCareProducts(await listCareProducts(clinic.id));
                  setCardNote("Product removed. Stock is restored.");
                  window.dispatchEvent(new CustomEvent("bitvion-stock"));
                }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not remove the product"));
              }} /> : null}
            </SheetBody>
          </SheetContent>
        ) : null}
      </Sheet>
    </Shell>
  );
}

function CallerDashboard({ title, institute }: { title: string; institute: boolean }) {
  const { workspaces, error } = useWorkspaces();
  const workspace = workspaces.find((item) => item.workspaceType === (institute ? "institute" : "clinic")) ?? workspaces[0];
  const [leads, setLeads] = useState(0);
  const [followups, setFollowups] = useState(0);
  const [calls, setCalls] = useState({ dials: "0", connected: "0", rejected: "0", talk: "0:00" });
  const [students, setStudents] = useState<DeskStudent[]>([]);
  const [filter, setFilter] = useState<DeskFilter>(institute ? "all" : "yearly");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [open, setOpen] = useState<DeskStudent | null>(null);
  const [edit, setEdit] = useState<StudentDetails>({ fullName: "", mobile: "", email: "", gender: "other", dateOfBirth: null, address: "", course: "", batch: "", admissionDate: null, status: "enquiry" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!workspace) return;
    void countRows("leads", workspace.id).then(setLeads);
    void listFollowUps(workspace.id).then((rows) => setFollowups(rows.filter((row) => row.status === "pending").length)).catch(() => setFollowups(0));
    void callDeskReport(workspace.id, false).then((row) => setCalls({
      dials: String(row.dials),
      connected: String(row.connected),
      rejected: String(row.rejected),
      talk: formatClock(row.talkSeconds),
    })).catch(() => setCalls({ dials: "—", connected: "—", rejected: "—", talk: "—" }));
    if (institute) void listDeskStudents(workspace.id).then(setStudents).catch(() => setStudents([]));
  }, [institute, workspace]);
  const visible = useMemo(() => students.filter((student) => studentMatches(student, filter, customFrom, customTo)), [students, filter, customFrom, customTo]);
  return (
    <Shell title={title}>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Leads" value={String(leads)} />
        <Stat label="Pending follow-ups" value={String(followups)} />
        <Stat label="Today's dials" value={calls.dials} />
        <Stat label="Connected" value={calls.connected} />
        <Stat label="Rejected" value={calls.rejected} />
        <Stat label="Talk time" value={calls.talk} />
      </div>
      <div className="flex flex-wrap gap-2">
        {institute ? <Tile to="/bookings" label="Bookings" /> : <Tile to="/appointments" label="Appointments" />}
        <Tile to="/leads" label="Leads" />
        <Tile to="/pipeline" label="Pipeline" />
        <Tile to="/follow-ups" label="Follow-ups" />
        <Tile to="/calls" label="Call time" />
        {institute ? <Tile to="/institute" label="Admissions and certificates" /> : null}
        <Tile to="/whatsapp" label="View WhatsApp" />
      </div>
      {institute ? (
        <>
          <FilterBar
            filter={filter}
            customFrom={customFrom}
            customTo={customTo}
            onFilter={setFilter}
            onFrom={setCustomFrom}
            onTo={setCustomTo}
            count={visible.length}
            noun="students"
            labels={{ appointment_today: "Admitted today", upcoming: "Upcoming admissions" }}
          />
          {visible.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No students in this range.</p> : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((student) => (
                <div key={student.id} className="touch-card rounded-2xl border border-line bg-white p-4 text-left shadow-sm sm:transition sm:hover:-translate-y-0.5 sm:hover:border-[#c6a15b] sm:hover:shadow-md">
                <button type="button" onClick={() => { setOpen(student); setEdit(detailsFromStudent(student)); }} className="w-full text-left">
                  <div className="flex items-start gap-3">
                    <Portrait name={student.full_name} path={student.photo_path} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-semibold break-words text-ink">{student.full_name}</span>
                      <span className="mt-0.5 block text-xs text-muted">{student.student_code}</span>
                    </span>
                    <StatusChip status={student.status} />
                  </div>
                  <p className="mt-3 text-sm text-ink">{student.mobile || "No mobile"}</p>
                  <p className="mt-1 text-xs text-muted">{student.course || "No course"}{student.batch ? ` · ${student.batch}` : ""}{student.admission_date ? ` · Admitted ${student.admission_date}` : ""}</p>
                </button>
                <span className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm" onClick={() => { setOpen(student); setEdit(detailsFromStudent(student)); }}>Edit</button>
                  <button type="button" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-danger" onClick={() => {
                    if (!window.confirm(`Delete ${student.full_name}?`)) return;
                    void removeStudent(student.id).then(() => setStudents((current) => current.filter((item) => item.id !== student.id))).catch(() => undefined);
                  }}>Delete</button>
                  {phoneTel(student.mobile) ? <a href={phoneTel(student.mobile)} className="inline-flex min-h-11 items-center text-sm font-medium text-navy">Call</a> : null}
                </span>
                </div>
              ))}
            </div>
          )}
          <Sheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpen(null); }}>
            {open ? (
              <SheetContent title={open.full_name}>
                <SheetHeader>
                  <div className="flex items-center gap-3">
                    <Portrait name={open.full_name} path={open.photo_path} className="size-16 text-xl" />
                    <div>
                      <p className="text-xs font-medium tracking-wide text-[#a6843d] uppercase">{open.student_code}</p>
                      <h2 className="mt-1 text-xl font-semibold break-words">{open.full_name}</h2>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-muted">{open.course || "No course"}</p>
                </SheetHeader>
                <SheetBody className="space-y-4">
                  {workspace ? (
                    <label className="inline-flex cursor-pointer rounded-full border border-line px-3 py-1.5 text-sm">
                      Change photo
                      <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file || !open) return;
                        void savePersonPhoto("students", open.id, workspace.organizationId, workspace.id, file)
                          .then((path) => {
                            setStudents((current) => current.map((item) => item.id === open.id ? { ...item, photo_path: path } : item));
                            setOpen({ ...open, photo_path: path });
                          })
                          .catch(() => undefined);
                      }} />
                    </label>
                  ) : null}
                  <StudentForm value={edit} onChange={setEdit} />
                  {workspace ? (
                    <button type="button" className="min-h-11 rounded-md bg-navy px-4 text-sm text-white" disabled={saving} onClick={() => {
                      setSaving(true);
                      void saveStudentDetails(open.id, workspace.organizationId, workspace.id, edit)
                        .then(() => {
                          const next = { ...open, full_name: edit.fullName.trim(), mobile: edit.mobile.trim(), email: edit.email.trim(), gender: edit.gender, date_of_birth: edit.dateOfBirth, address: edit.address.trim(), course: edit.course.trim(), batch: edit.batch.trim(), admission_date: edit.admissionDate, status: edit.status };
                          setStudents((current) => current.map((item) => item.id === open.id ? next : item));
                          setOpen(next);
                        })
                        .catch(() => undefined)
                        .finally(() => setSaving(false));
                    }}>{saving ? "Saving" : "Save student"}</button>
                  ) : null}
                  {workspace ? <StudentFile organizationId={workspace.organizationId} workspaceId={workspace.id} studentId={open.id} onError={() => undefined} /> : null}
                </SheetBody>
              </SheetContent>
            ) : null}
          </Sheet>
        </>
      ) : null}
    </Shell>
  );
}

function ClinicCallerDashboard() {
  return <CallerDashboard title="Clinic telecaller" institute={false} />;
}

function InstituteCallerDashboard() {
  return <CallerDashboard title="Institute telecaller" institute />;
}

export type DeskFilter = "all" | "today" | "yesterday" | "appointment_today" | "upcoming" | "weekly" | "monthly" | "yearly" | "custom";

const FILTERS: Array<{ key: DeskFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "appointment_today", label: "Appointment today" },
  { key: "upcoming", label: "Upcoming bookings" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
  { key: "custom", label: "Custom" },
];

export function FilterBar({ filter, customFrom, customTo, onFilter, onFrom, onTo, count, noun, labels }: {
  filter: DeskFilter;
  customFrom: string;
  customTo: string;
  onFilter: (value: DeskFilter) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  count: number;
  noun: string;
  labels?: Partial<Record<DeskFilter, string>>;
}) {
  return (
    <div className="space-y-3">
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((item) => (
          <button key={item.key} type="button" onClick={() => onFilter(item.key)} className={`min-h-11 shrink-0 rounded-full px-3.5 text-sm ${filter === item.key ? "bg-[#0e1420] text-[#e8d5a3]" : "border border-line bg-white text-ink"}`}>
            {labels?.[item.key] ?? item.label}
          </button>
        ))}
        {filter === "custom" ? (
          <>
            <input type="date" aria-label="From" className="h-11 shrink-0 rounded-full border border-line bg-white px-3 text-base" value={customFrom} onChange={(event) => onFrom(event.target.value)} />
            <input type="date" aria-label="To" className="h-11 shrink-0 rounded-full border border-line bg-white px-3 text-base" value={customTo} onChange={(event) => onTo(event.target.value)} />
          </>
        ) : null}
      </div>
      <p className="text-sm text-muted">{count.toLocaleString("en-IN")} {noun}</p>
    </div>
  );
}

function boundsFor(filter: DeskFilter, customFrom: string, customTo: string) {
  if (filter === "all") return { from: new Date(0), to: new Date(8640000000000000) };
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  if (filter === "upcoming") return { from: endToday, to: new Date(now.getFullYear() + 2, 0, 1) };
  if (filter === "appointment_today" || filter === "today") return { from: start, to: endToday };
  if (filter === "yesterday") return { from: new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1), to: start };
  if (filter === "weekly") {
    const monday = new Date(start);
    monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { from: monday, to: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7) };
  }
  const key: RangeKey = filter === "monthly" ? "this_month" : filter === "yearly" ? "this_year" : "custom";
  const bounds = rangeBounds(key, customFrom, customTo, now);
  return { from: new Date(bounds.from), to: new Date(bounds.to) };
}

function inside(iso: string | null, from: Date, to: Date) {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return time >= from.getTime() && time < to.getTime();
}

function moneyStamp(value: string) {
  return value.length === 10 ? `${value}T12:00:00` : value;
}

function dayKey(value: string) {
  const date = new Date(moneyStamp(value));
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function rangedAppointments(patient: DeskPatient, filter: DeskFilter, customFrom: string, customTo: string) {
  if (filter === "all") return patient.appointments;
  const span = boundsFor(filter, customFrom, customTo);
  if (filter === "upcoming") return patient.appointments.filter((item) => new Date(item.starts_at).getTime() >= span.from.getTime() && !["completed", "no_show", "cancelled"].includes(item.status));
  if (filter === "appointment_today") return patient.appointments.filter((item) => item.status !== "cancelled" && inside(item.starts_at, span.from, span.to));
  return patient.appointments.filter((item) => inside(item.starts_at, span.from, span.to));
}

function patientMatches(patient: DeskPatient, filter: DeskFilter, customFrom: string, customTo: string) {
  if (filter === "all") return true;
  const span = boundsFor(filter, customFrom, customTo);
  const live = patient.appointments.filter((item) => item.status !== "cancelled");
  if (filter === "appointment_today") return live.some((item) => inside(item.starts_at, span.from, span.to));
  if (filter === "upcoming") return live.some((item) => new Date(item.starts_at).getTime() >= span.from.getTime() && !["completed", "no_show"].includes(item.status));
  return inside(patient.created_at, span.from, span.to) || live.some((item) => inside(item.starts_at, span.from, span.to));
}

export function studentMatches(student: DeskStudent, filter: DeskFilter, customFrom: string, customTo: string) {
  if (filter === "all") return true;
  const span = boundsFor(filter, customFrom, customTo);
  const stamp = student.admission_date ? `${student.admission_date}T00:00:00` : student.created_at;
  if (filter === "upcoming") return student.status === "enquiry" || student.status === "admitted" || student.status === "booked";
  if (filter === "appointment_today") return inside(stamp, span.from, span.to);
  return inside(stamp, span.from, span.to) || inside(student.created_at, span.from, span.to);
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: iso.includes("T") ? "numeric" : undefined, minute: iso.includes("T") ? "2-digit" : undefined });
}

function StatusChip({ status }: { status: string }) {
  const tone = status === "arrived" || status === "active" || status === "admitted"
    ? "bg-emerald-50 text-emerald-800"
    : status === "cancelled" || status === "no_show"
      ? "bg-red-50 text-red-700"
      : "bg-[#faf6ee] text-[#8a6a2f]";
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium capitalize ${tone}`}>{status.replaceAll("_", " ")}</span>;
}

function doctorName(doctorId: string, doctors: Array<{ userId: string; name: string }>) {
  const row = doctors.find((item) => item.userId === doctorId);
  if (!row) return "Doctor";
  const [person, role] = row.name.split(" · ");
  return person && person !== "Doctor" ? person : role || "Doctor";
}

function PatientFile({ record, doctors, onRemoveProduct }: { record: PatientRecord; doctors: Array<{ userId: string; name: string }>; onRemoveProduct?: (itemId: string) => void }) {
  const groups = new Map<string, PatientTreatment[]>();
  for (const treatment of record.treatments) {
    const name = treatment.doctorId ? doctorName(treatment.doctorId, doctors) : "Doctor not recorded";
    groups.set(name, [...(groups.get(name) ?? []), treatment]);
  }
  const products = record.treatments.flatMap((treatment) => treatment.products.map((item) => ({ ...item, when: treatment.when, doctor: treatment.doctorId ? doctorName(treatment.doctorId, doctors) : "Doctor not recorded" })));
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold">Treatments by doctor</h3>
        {record.treatments.length === 0 ? <p className="mt-2 text-sm text-muted">No treatments recorded yet.</p> : [...groups].map(([name, visits]) => (
          <div key={name} className="mt-3">
            <p className="text-sm font-medium text-[#8a6a2f]">{name}</p>
            {visits.map((visit) => (
              <article key={visit.id} className="mt-2 rounded-xl border border-line px-3 py-3 text-sm">
                <p className="font-medium">{visit.title}</p>
                <p className="mt-1 text-xs text-muted">{formatWhen(visit.when)}</p>
                {visit.detail ? <p className="mt-2 whitespace-pre-wrap">{visit.detail}</p> : null}
                {visit.prescriptions.map((item) => (
                  <p key={item.id || item.medicine} className="mt-2">{[item.medicine, item.dosage, item.frequency, item.duration ? `for ${item.duration}` : ""].filter(Boolean).join(" · ")}</p>
                ))}
                {visit.notes ? <p className="mt-2 text-muted">{visit.notes}</p> : null}
                {visit.products.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {visit.products.map((item, index) => (
                      <li key={`${visit.id}-${index}`}>{item.name} × {item.quantity} · {inr(item.amount)}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        ))}
      </section>
      <section>
        <h3 className="text-sm font-semibold">Products bought</h3>
        {products.length === 0 ? <p className="mt-2 text-sm text-muted">No products bought yet.</p> : products.map((item, index) => (
          <div key={`${item.id || item.name}-${index}`} className="mt-2 flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
            <div>
              <p className="font-medium">{item.name} × {item.quantity}</p>
              <p className="mt-1 text-xs text-muted">{formatWhen(item.when)} · {item.doctor} · {inr(item.amount)}</p>
            </div>
            {onRemoveProduct && item.id ? <button type="button" className="min-h-11 shrink-0 text-sm font-medium text-danger" onClick={() => onRemoveProduct(item.id)}>Remove</button> : null}
          </div>
        ))}
      </section>
      <section>
        <h3 className="text-sm font-semibold">Bills and balance</h3>
        {record.bills.length === 0 ? <p className="mt-2 text-sm text-muted">No bills yet.</p> : record.bills.map((bill) => (
          <article key={bill.id} className="mt-2 rounded-xl border border-line px-3 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{bill.number || "Invoice"}</p>
              <StatusChip status={bill.status} />
            </div>
            <p className="mt-1 text-xs text-muted">{bill.issuedOn}</p>
            {bill.items.map((item, index) => (
              <p key={`${bill.id}-${index}`} className="mt-2">{item.description} × {item.quantity} · {inr(item.amount)}</p>
            ))}
            <p className="mt-2">Total {inr(bill.total)} · Paid {inr(bill.paid)} · Balance {inr(bill.balance)}</p>
          </article>
        ))}
      </section>
    </div>
  );
}


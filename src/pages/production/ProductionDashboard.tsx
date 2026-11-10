import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BusinessBoard } from "@/components/dashboard/BusinessBoard";
import { StudentFile } from "@/components/institute/StudentFile";
import { detailsFromStudent, StudentForm } from "@/components/institute/StudentForm";
import { Portrait } from "@/components/shared/Portrait";
import { VisitAccount } from "@/components/clinic/BillingDesk";
import { PatientHistory } from "@/components/clinic/PatientHistory";
import { Sheet, SheetBody, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useDesk } from "@/context/DeskContext";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { loadDoctorPulse } from "@/services/clinic-care";
import { formatClock } from "@/lib/call-time";
import { DialLink } from "@/components/calls/DialLink";
import { phoneTel } from "@/lib/phone";
import { isClinicDoctor, productionRoleLabel } from "@/lib/production-access";
import { rangeBounds, type RangeKey } from "@/lib/range";
import { callDeskReport, countRows, listClinicBills, listDeskMoney, listDeskPatients, listDeskStudents, listFollowUps, clearDeskCache, ensureFollowUpVisit, removeAppointment, removeDeskMoney, removePatient, removeStudent, savePersonPhoto, saveStudentDetails, updateAppointment, updatePatient, type ClinicBill, type DeskMoney, type DeskPatient, type DeskStudent, type StudentDetails } from "@/services/production-ops";
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
  if (isClinicDoctor(key)) return <DoctorDashboard />;
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

type DoctorFilter = "today" | "upcoming" | "weekly" | "monthly" | "yearly" | "custom";

const DOCTOR_FILTERS: Array<{ key: DoctorFilter; label: string }> = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
  { key: "custom", label: "Custom" },
];

function DoctorDashboard() {
  const { productionUser, session } = useAuth();
  const doctorId = productionUser?.userId ?? "";
  const title = session?.name || productionRoleLabel(productionUser?.roleKey ?? "doctor");
  const { workspaces, error } = useWorkspaces();
  const clinic = workspaces.find((item) => item.workspaceType === "clinic") ?? workspaces[0];
  const [filter, setFilter] = useState<DoctorFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [pulse, setPulse] = useState({ consulted: 0, patients: 0, pending: 0, units: 0, days: [] as Array<{ day: string; sold: number }> });
  const [allMine, setAllMine] = useState<DeskPatient[]>([]);
  const [open, setOpen] = useState<DeskPatient | null>(null);
  const [doctors, setDoctors] = useState<Array<{ userId: string; name: string }>>([]);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [seenUpcoming, setSeenUpcoming] = useState<string[]>([]);

  useEffect(() => {
    if (!doctorId) {
      setSeenUpcoming([]);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(`doctor-upcoming-seen:${doctorId}`);
      setSeenUpcoming(raw ? JSON.parse(raw) as string[] : []);
    } catch {
      setSeenUpcoming([]);
    }
  }, [doctorId]);

  const reloadPulse = () => {
    if (!clinic || !doctorId) return;
    const bounds = doctorFilterBounds(filter, customFrom, customTo);
    void loadDoctorPulse(clinic.id, bounds.fromDate, bounds.toDate, bounds.from, bounds.to, doctorId).then(setPulse).catch(() => setPulse({ consulted: 0, patients: 0, pending: 0, units: 0, days: [] }));
  };

  const reloadCards = () => {
    if (!clinic || !doctorId) return;
    clearDeskCache();
    void listDeskPatients(clinic.id).then((rows) => {
      const next = rows.filter((patient) => patientAssignedToDoctor(patient, doctorId));
      setAllMine(next);
      setOpen((current) => current ? next.find((item) => item.id === current.id) ?? current : current);
    }).catch(() => setAllMine([]));
  };

  useEffect(() => {
    if (!clinic || !doctorId) return;
    reloadPulse();
    reloadCards();
    void listDoctors(clinic.id).then(setDoctors).catch(() => setDoctors([]));
    const timer = window.setInterval(() => {
      reloadCards();
      reloadPulse();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [clinic, doctorId, filter, customFrom, customTo]);

  const visible = useMemo(
    () => allMine.filter((patient) => doctorPatientInFilter(patient, doctorId, filter, customFrom, customTo)),
    [allMine, doctorId, filter, customFrom, customTo],
  );

  const upcomingAssigned = useMemo(() => {
    const rows: Array<{ patient: DeskPatient; appointment: DeskPatient["appointments"][number] }> = [];
    for (const patient of allMine) {
      for (const appointment of doctorUpcomingAppointments(patient, doctorId)) {
        rows.push({ patient, appointment });
      }
    }
    return rows.sort((left, right) => left.appointment.starts_at.localeCompare(right.appointment.starts_at));
  }, [allMine, doctorId]);

  const newUpcoming = useMemo(
    () => upcomingAssigned.filter((row) => !seenUpcoming.includes(row.appointment.id)),
    [upcomingAssigned, seenUpcoming],
  );

  useEffect(() => {
    if (!doctorId || newUpcoming.length === 0) return;
    setNotice(`${newUpcoming.length} upcoming patient${newUpcoming.length === 1 ? "" : "s"} assigned to you.`);
  }, [doctorId, newUpcoming.length]);

  const markUpcomingSeen = () => {
    const ids = [...new Set([...seenUpcoming, ...upcomingAssigned.map((row) => row.appointment.id)])];
    setSeenUpcoming(ids);
    try {
      window.sessionStorage.setItem(`doctor-upcoming-seen:${doctorId}`, JSON.stringify(ids));
    } catch {
      // ignore storage errors
    }
    setNotice("");
  };

  return (
    <Shell title={title}>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      <p className="text-sm text-muted">Only your real assigned patients and visits. Reception assignments stay on this desk.</p>

      {upcomingAssigned.length > 0 ? (
        <section className="rounded-2xl border border-[#c6a15b] bg-[#faf6ee] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#8a6a2f] uppercase">Upcoming assigned</p>
              <p className="mt-1 text-sm font-medium">
                {newUpcoming.length > 0
                  ? `${newUpcoming.length} new assignment${newUpcoming.length === 1 ? "" : "s"} waiting`
                  : `${upcomingAssigned.length} upcoming visit${upcomingAssigned.length === 1 ? "" : "s"} on your list`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-md border border-line bg-white px-3 text-sm" onClick={() => setFilter("upcoming")}>Show upcoming</button>
              {newUpcoming.length > 0 ? <button type="button" className="min-h-11 rounded-md bg-navy px-3 text-sm text-white" onClick={markUpcomingSeen}>Mark seen</button> : null}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {upcomingAssigned.slice(0, 5).map(({ patient, appointment }) => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => setOpen(patient)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm ${seenUpcoming.includes(appointment.id) ? "border-line bg-white" : "border-[#c6a15b] bg-white"}`}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{patient.full_name}</span>
                  <span className="mt-0.5 block text-xs text-muted">{formatWhen(appointment.starts_at)}{appointment.reason ? ` · ${appointment.reason}` : ""}</span>
                </span>
                {!seenUpcoming.includes(appointment.id) ? <span className="shrink-0 rounded-full bg-[#0e1420] px-2 py-1 text-[11px] font-medium text-[#e8d5a3]">New</span> : <span className="shrink-0 text-xs capitalize text-muted">{appointment.status.replaceAll("_", " ")}</span>}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DOCTOR_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={`min-h-11 shrink-0 rounded-full px-3.5 text-sm ${filter === item.key ? "bg-[#0e1420] text-[#e8d5a3]" : "border border-line bg-white text-ink"}`}
          >
            {item.label}
          </button>
        ))}
        {filter === "custom" ? (
          <>
            <input type="date" aria-label="From" className="h-11 shrink-0 rounded-full border border-line bg-white px-3 text-base" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            <input type="date" aria-label="To" className="h-11 shrink-0 rounded-full border border-line bg-white px-3 text-base" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          </>
        ) : null}
      </div>
      <p className="text-sm text-muted">{visible.length.toLocaleString("en-IN")} patients in {DOCTOR_FILTERS.find((item) => item.key === filter)?.label.toLowerCase() || "this range"}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total consulted" value={String(pulse.consulted)} hint="Your treatments in this range" />
        <Stat label="Patients consulted" value={String(pulse.patients)} hint="Unique patients you treated" />
        <Stat label="Pending" value={String(pulse.pending)} hint="Your open appointments" />
        <Stat label="Products sold" value={String(pulse.units)} hint="Units from your visits" />
      </div>
      <div className="flex flex-wrap gap-2"><Tile to="/clinic" label="Patients and consultations" /><Tile to="/inventory" label="Stock" /></div>
      <section>
        <h2 className="text-sm font-semibold">Your patients</h2>
        {visible.length === 0 ? <p className="mt-2 text-sm text-muted">No patients in this filter yet. Reception must assign the visit to you.</p> : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((patient) => {
              const visit = doctorVisitForFilter(patient, doctorId, filter, customFrom, customTo);
              const latest = [...patient.treatments].sort((left, right) => right.performed_on.localeCompare(left.performed_on))[0];
              return (
                <button key={patient.id} type="button" onClick={() => setOpen(patient)} className="touch-card flex gap-3 rounded-2xl border border-line bg-white p-3 text-left hover:border-[#c6a15b]">
                  <Portrait name={patient.full_name} path={patient.photo_path} />
                  <span className="min-w-0">
                    <span className="block font-medium">{patient.full_name}</span>
                    <span className="mt-1 block text-xs text-muted">{patient.patient_code} · {patient.mobile || "No mobile"}</span>
                    <span className="mt-2 block text-sm">{visit ? `${formatWhen(visit.starts_at)} · ${visit.status.replaceAll("_", " ")}` : latest ? `Last visit ${latest.performed_on} · ${latest.title}` : "Assigned by reception"}</span>
                  </span>
                </button>
              );
            })}
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
        {open && clinic ? (
          <SheetContent title={open.full_name}>
            <SheetHeader>
              <p className="text-lg font-semibold">Patient from reception</p>
              <p className="text-sm text-muted">Add the treatment, procedure, products, and how long the medicine is given. Reception sees everything on this card.</p>
            </SheetHeader>
            <SheetBody>
              <PatientHistory
                patient={open}
                workspace={clinic}
                doctors={doctors}
                currentUserId={doctorId}
                onChanged={() => { reloadCards(); reloadPulse(); }}
                onDeleted={() => { setOpen(null); reloadCards(); reloadPulse(); }}
                onNotice={setNotice}
                onError={setFormError}
              />
              {formError ? <p className="mt-3 text-sm text-danger">{formError}</p> : null}
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
  const [bills, setBills] = useState<ClinicBill[]>([]);
  const [money, setMoney] = useState<DeskMoney[]>([]);
  const [filter, setFilter] = useState<DeskFilter>("all");
  const [focus, setFocus] = useState<"patients" | "appointments" | "arrived" | "followups">("patients");
  const [followAt, setFollowAt] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [open, setOpen] = useState<DeskPatient | null>(null);
  const [recordError, setRecordError] = useState("");
  const [doctors, setDoctors] = useState<Array<{ userId: string; name: string }>>([]);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardNote, setCardNote] = useState("");
  const [moneyBusy, setMoneyBusy] = useState("");
  const [patientEdit, setPatientEdit] = useState({ fullName: "", mobile: "", email: "", gender: "other", dateOfBirth: "", place: "", address: "", emergency: "", notes: "" });
  useEffect(() => {
    if (!clinic) return;
    void listDoctors(clinic.id).then(setDoctors).catch(() => setDoctors([]));
  }, [clinic]);
  useEffect(() => {
    if (!open) return;
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
    setRecordError("");
    const next = nextFollowUp(open);
    setFollowAt(next ? localFollowInput(next.starts_at) : "");
  }, [open]);
  useEffect(() => {
    if (!clinic) return;
    void listDeskPatients(clinic.id).then(setCards).catch(() => setCards([]));
    void listClinicBills(clinic.id).then(setBills).catch(() => setBills([]));
    void listDeskMoney(clinic.id).then(setMoney).catch(() => setMoney([]));
    const refresh = () => {
      clearDeskCache();
      void listDeskPatients(clinic.id).then(setCards).catch(() => undefined);
      void listClinicBills(clinic.id).then(setBills).catch(() => undefined);
      void listDeskMoney(clinic.id).then(setMoney).catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [clinic]);
  const incomeRows = useMemo(() => money.filter((row) => row.kind === "income").sort((left, right) => right.at.localeCompare(left.at)), [money]);
  const incomeTotal = incomeRows.reduce((sum, row) => sum + row.amount, 0);
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
  const followPatients = useMemo(() => cards.filter((patient) => Boolean(nextFollowUp(patient))), [cards]);
  const shown = focus === "appointments" ? withAppointments : focus === "arrived" ? arrivedPatients : focus === "followups" ? followPatients : visible;
  const shownLabel = focus === "appointments" ? "patients with appointments" : focus === "arrived" ? "arrived patients" : focus === "followups" ? "follow-ups" : "patients";
  const choose = (next: "patients" | "appointments" | "arrived" | "followups") => {
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
        <Stat label="Follow-ups" value={String(followPatients.length)} hint="Due back" active={focus === "followups"} onClick={() => choose("followups")} />
        <Stat label="Income" value={inr(incomeTotal)} hint="Collected for the clinic" />
      </div>
      <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
        <h2 className="text-sm font-semibold">Income</h2>
        {incomeRows.length === 0 ? <p className="mt-2 text-sm text-muted">No income yet.</p> : (
          <div className="mt-3 space-y-2">
            {incomeRows.slice(0, 12).map((row) => {
              const person = cards.find((item) => item.id === row.patientId);
              return (
                <div key={`${row.source}-${row.id}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{person?.full_name || "Clinic"} · {row.note || "Payment"}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="font-medium">{inr(row.amount)}</span>
                    <button
                      type="button"
                      disabled={moneyBusy === row.id}
                      className="min-h-11 text-sm font-medium text-danger disabled:opacity-50"
                      onClick={() => {
                        if (!window.confirm(`Delete ${inr(row.amount)} income${person?.full_name ? ` for ${person.full_name}` : ""}?`)) return;
                        setMoneyBusy(row.id);
                        setRecordError("");
                        void removeDeskMoney(row)
                          .then(() => {
                            setMoney((current) => current.filter((item) => !(item.id === row.id && item.source === row.source)));
                            setCardNote("Income deleted.");
                            if (clinic) {
                              clearDeskCache();
                              void listClinicBills(clinic.id).then(setBills).catch(() => undefined);
                            }
                          })
                          .catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not delete the income"))
                          .finally(() => setMoneyBusy(""));
                      }}
                    >
                      {moneyBusy === row.id ? "…" : "Delete"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {recordError && !open ? <p className="mt-2 text-sm text-danger">{recordError}</p> : null}
      </section>
      <div className="flex flex-wrap gap-2"><Tile to="/appointments" label="Appointments" /><Tile to="/clinic" label="Register and appointments" /><Tile to="/billing" label="Billing" /><Tile to="/inventory" label="Stock" /></div>
      <FilterBar filter={filter} customFrom={customFrom} customTo={customTo} onFilter={setFilter} onFrom={setCustomFrom} onTo={setCustomTo} count={shown.length} noun={shownLabel} />
      <div id="reception-cards">
      {shown.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No patients in this range.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((patient) => {
            const latest = [...patient.appointments].sort((left, right) => left.starts_at.localeCompare(right.starts_at)).at(-1);
            const doctorsOnCard = assignedDoctorIds(patient).map((id) => doctorName(id, doctors));
            const care = treatmentSummary(patient);
            return (
              <article key={patient.id} className="touch-card rounded-2xl border border-line bg-white p-4 shadow-sm sm:transition sm:hover:-translate-y-0.5 sm:hover:border-[#c6a15b] sm:hover:shadow-md">
                <button type="button" onClick={() => setOpen(patient)} className="w-full text-left">
                  <div className="flex items-center gap-3">
                    <Portrait name={patient.full_name} path={patient.photo_path} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="block truncate text-base font-semibold text-ink">{patient.full_name}</span>
                        {latest ? <StatusChip status={latest.status} /> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{patient.patient_code}</span>
                      <span className="mt-2 block truncate text-sm text-ink">{patient.mobile || "No mobile"}{patient.place ? ` · ${patient.place}` : ""}</span>
                      <span className="mt-1 block text-sm font-medium text-[#8a6a2f]">{doctorsOnCard.length ? doctorsOnCard.join(" · ") : "No doctor assigned"}</span>
                      {care ? <span className="mt-1 block text-sm">Care on card · {care}</span> : <span className="mt-1 block text-sm text-muted">Waiting for doctor treatment</span>}
                      {nextFollowUp(patient) ? <span className="mt-1 block text-sm font-medium text-[#8a6a2f]">Follow-up {formatWhen(nextFollowUp(patient)?.starts_at || "")}</span> : null}
                    </span>
                  </div>
                </button>
                {clinic && phoneTel(patient.mobile) ? <DialLink organizationId={clinic.organizationId} workspaceId={clinic.id} name={patient.full_name} phone={patient.mobile} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-navy" /> : null}
              </article>
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
                <div className="min-w-0">
                  <p className="text-xs font-medium tracking-wide text-[#a6843d] uppercase">{open.patient_code}</p>
                  <h2 className="mt-1 truncate text-xl font-semibold">{open.full_name}</h2>
                  <p className="mt-1 text-sm text-muted">{open.mobile || "No mobile"}{open.place ? ` · ${open.place}` : ""}</p>
                </div>
              </div>
            </SheetHeader>
            <SheetBody className="space-y-4">
              <PatientFileSummary patient={open} bills={bills.filter((bill) => bill.patientId === open.id)} recorded={patientTotal.get(open.id) ?? 0} />
              <VisitAccount
                bills={bills.filter((bill) => bill.patientId === open.id)}
                treatments={open.treatments}
                collected={money.filter((row) => row.kind === "income" && row.patientId === open.id).map((row) => ({ note: row.note, amount: row.amount }))}
                onChanged={() => {
                  if (!clinic) return;
                  clearDeskCache();
                  setCardNote("Visit balance updated.");
                  void listClinicBills(clinic.id).then(setBills).catch(() => undefined);
                  void listDeskPatients(clinic.id).then((rows) => {
                    setCards(rows);
                    const next = rows.find((item) => item.id === open.id);
                    if (next) setOpen(next);
                  }).catch(() => undefined);
                  void listDeskMoney(clinic.id).then(setMoney).catch(() => undefined);
                }}
                onError={setRecordError}
              />
              <div className="flex flex-wrap gap-2">
                {clinic && phoneTel(open.mobile) ? <DialLink organizationId={clinic.organizationId} workspaceId={clinic.id} name={open.full_name} phone={open.mobile} className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-navy" /> : null}
                <Link to={`/billing?patient=${open.id}`} className="inline-flex min-h-11 items-center rounded-full bg-navy px-4 text-sm font-medium text-white">Open billing</Link>
                {clinic ? (
                  <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-white px-4 text-sm">
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
              </div>
              {cardNote ? <p className="text-sm text-emerald-700">{cardNote}</p> : null}
              <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
              <h3 className="text-sm font-semibold">Patient details</h3>
              <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(event) => {
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
                  <button type="button" disabled={cardBusy} className="min-h-11 text-sm font-medium text-danger disabled:opacity-50" onClick={() => {
                    if (!window.confirm(`Delete ${open.full_name}? This removes the patient card from Reception.`)) return;
                    const patientId = open.id;
                    setCardBusy(true);
                    setRecordError("");
                    clearDeskCache();
                    void removePatient(patientId)
                      .then(async () => {
                        if (clinic) {
                          const rows = await listDeskPatients(clinic.id);
                          setCards(rows.filter((item) => item.id !== patientId));
                          void listDeskMoney(clinic.id).then(setMoney).catch(() => undefined);
                          void listClinicBills(clinic.id).then(setBills).catch(() => undefined);
                        } else {
                          setCards((current) => current.filter((item) => item.id !== patientId));
                        }
                        setOpen(null);
                        setCardNote("Patient deleted.");
                      })
                      .catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not delete the patient"))
                      .finally(() => setCardBusy(false));
                  }}>{cardBusy ? "Deleting…" : "Delete"}</button>
                </div>
              </form>
              </section>
              {clinic ? (
                <PatientHistory
                  patient={open}
                  workspace={clinic}
                  doctors={doctors}
                  currentUserId=""
                  showDetails={false}
                  showAppointments={false}
                  onChanged={() => {
                    clearDeskCache();
                    void listDeskPatients(clinic.id).then((rows) => {
                      setCards(rows);
                      const next = rows.find((item) => item.id === open.id);
                      if (next) setOpen(next);
                    }).catch(() => undefined);
                  }}
                  onDeleted={() => {
                    setCards((current) => current.filter((item) => item.id !== open.id));
                    setMoney((current) => current.filter((item) => item.patientId !== open.id));
                    setBills((current) => current.filter((item) => item.patientId !== open.id));
                    setOpen(null);
                    setCardNote("Patient deleted.");
                  }}
                  onNotice={setCardNote}
                  onError={setRecordError}
                />
              ) : null}
              <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
                <h3 className="text-sm font-semibold">Follow-up</h3>
                <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={(event) => {
                  event.preventDefault();
                  if (!clinic || !followAt) return;
                  setCardBusy(true);
                  void ensureFollowUpVisit({
                    organizationId: clinic.organizationId,
                    workspaceId: clinic.id,
                    patientId: open.id,
                    when: followAt,
                    exact: true,
                  }).then(() => {
                    clearDeskCache();
                    return listDeskPatients(clinic.id);
                  }).then((rows) => {
                    setCards(rows);
                    const next = rows.find((item) => item.id === open.id);
                    if (next) setOpen(next);
                    setCardNote("Follow-up saved on the reception list.");
                  }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not save the follow-up")).finally(() => setCardBusy(false));
                }}>
                  <label className="text-sm">Date and time
                    <input required type="datetime-local" value={followAt} onChange={(event) => setFollowAt(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" />
                  </label>
                  <button type="submit" disabled={cardBusy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:self-end">{cardBusy ? "Saving" : "Save follow-up"}</button>
                </form>
              </section>
              <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
                <h3 className="text-sm font-semibold">Bookings and doctor assignment</h3>
                <p className="mt-1 text-sm text-muted">Assign each visit to Doctor Rimisha, Doctor Siji, or Doctor Bhama. Their treatments stay on this card.</p>
                {open.appointments.length === 0 ? <p className="mt-2 text-sm text-muted">No appointments yet. Book one from Appointments or Clinic and choose the doctor.</p> : open.appointments.map((item) => (
                  <div key={item.id} className="mt-2 space-y-2 rounded-xl border border-line px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">{formatWhen(item.starts_at)}{item.reason ? ` · ${item.reason}` : ""}</span>
                      <StatusChip status={item.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={item.doctor_id || ""} onChange={(event) => {
                        const nextDoctor = event.target.value || null;
                        void updateAppointment(item.id, { doctorId: nextDoctor }).then(() => {
                          const next = { ...open, appointments: open.appointments.map((row) => row.id === item.id ? { ...row, doctor_id: nextDoctor || "" } : row) };
                          setOpen(next);
                          setCards((current) => current.map((patient) => patient.id === open.id ? next : patient));
                          setCardNote(nextDoctor ? `Assigned to ${doctorName(nextDoctor, doctors)}.` : "Doctor cleared.");
                        }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not assign the doctor"));
                      }} className="h-11 min-w-0 flex-1 rounded-md border border-line px-2">
                        <option value="">Choose doctor</option>
                        {doctors.map((doctor) => <option key={doctor.userId} value={doctor.userId}>{doctor.name}</option>)}
                      </select>
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
                        clearDeskCache();
                        void removeAppointment(item.id).then(() => {
                          const next = { ...open, appointments: open.appointments.filter((row) => row.id !== item.id) };
                          setOpen(next);
                          setCards((current) => current.map((patient) => patient.id === open.id ? next : patient));
                          setCardNote("Appointment deleted.");
                        }).catch((reason: unknown) => setRecordError(reason instanceof Error ? reason.message : "Could not delete the appointment"));
                      }}>Delete</button>
                    </div>
                  </div>
                ))}
              </section>
              {recordError ? <p className="text-sm text-danger">{recordError}</p> : null}
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
                  {workspace && phoneTel(student.mobile) ? <DialLink organizationId={workspace.organizationId} workspaceId={workspace.id} leadId={student.lead_id || null} name={student.full_name} phone={student.mobile} /> : null}
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

function PatientFileSummary({ patient, bills, recorded }: { patient: DeskPatient; bills: ClinicBill[]; recorded: number }) {
  const visits = [...patient.appointments].sort((left, right) => left.starts_at.localeCompare(right.starts_at));
  const follow = nextFollowUp(patient);
  const nextVisit = follow ?? visits.find((item) => !["completed", "cancelled", "no_show"].includes(item.status)) ?? visits.at(-1);
  const latestCare = [...patient.treatments].sort((left, right) => right.performed_on.localeCompare(left.performed_on))[0];
  const due = bills.reduce((sum, bill) => sum + bill.balance, 0);
  const billed = bills.reduce((sum, bill) => sum + bill.total, 0);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <article className="rounded-2xl border border-[#eadfca] bg-white px-3 py-3">
        <p className="text-[11px] font-medium tracking-wide text-[#8a6a2f] uppercase">Last treatment</p>
        <p className="mt-1 text-sm font-medium">{latestCare ? latestCare.title : "Not recorded yet"}</p>
        <p className="mt-1 text-xs text-muted">{latestCare ? `Saved on patient card · ${formatWhen(latestCare.performed_on)}` : "Waiting for the doctor"}</p>
      </article>
      <article className="rounded-2xl border border-[#eadfca] bg-white px-3 py-3">
        <p className="text-[11px] font-medium tracking-wide text-[#8a6a2f] uppercase">{follow ? "Follow-up" : "Appointment"}</p>
        <p className="mt-1 text-sm font-medium">{nextVisit ? formatWhen(nextVisit.starts_at) : "None booked"}</p>
        <p className="mt-1 text-xs text-muted">{nextVisit ? `${nextVisit.reason || "Visit"} · ${nextVisit.status.replaceAll("_", " ")}` : "No booking yet"}</p>
      </article>
      <article className="rounded-2xl border border-[#eadfca] bg-white px-3 py-3">
        <p className="text-[11px] font-medium tracking-wide text-[#8a6a2f] uppercase">Bill</p>
        <p className="mt-1 text-sm font-medium">{bills.length ? `${inr(billed)} billed` : recorded > 0 ? inr(recorded) : "No bill yet"}</p>
        <p className="mt-1 text-xs text-muted">{bills.length ? `Balance ${inr(due)}` : recorded > 0 ? "Recorded income" : "Open billing to add one"}</p>
      </article>
    </div>
  );
}

function nextFollowUp(patient: DeskPatient) {
  return patient.appointments
    .filter((item) => item.reason === "Follow-up" && (item.status === "scheduled" || item.status === "confirmed"))
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at))[0];
}

function localFollowInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function doctorName(doctorId: string, doctors: Array<{ userId: string; name: string }>) {
  return doctors.find((item) => item.userId === doctorId)?.name || "Doctor";
}

export function patientAssignedToDoctor(patient: DeskPatient, doctorId: string) {
  if (!doctorId) return false;
  return patient.appointments.some((item) => item.doctor_id === doctorId);
}

function assignedDoctorIds(patient: DeskPatient) {
  return [...new Set(patient.appointments.map((item) => item.doctor_id).filter(Boolean))];
}

function treatmentSummary(patient: DeskPatient) {
  const latest = [...patient.treatments].sort((left, right) => right.performed_on.localeCompare(left.performed_on))[0];
  return latest ? `${latest.performed_on} · ${latest.title}` : "";
}

function doctorFilterBounds(filter: DoctorFilter, customFrom: string, customTo: string) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  if (filter === "upcoming") {
    const to = new Date(now.getFullYear() + 2, 0, 1);
    return {
      from: endToday.toISOString(),
      to: to.toISOString(),
      fromDate: endToday.toISOString().slice(0, 10),
      toDate: new Date(to.getTime() - 1).toISOString().slice(0, 10),
      label: "Upcoming",
    };
  }
  if (filter === "weekly") {
    const monday = new Date(start);
    monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const weekEnd = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    return {
      from: monday.toISOString(),
      to: weekEnd.toISOString(),
      fromDate: monday.toISOString().slice(0, 10),
      toDate: new Date(weekEnd.getTime() - 1).toISOString().slice(0, 10),
      label: "Weekly",
    };
  }
  const key: RangeKey = filter === "monthly" ? "this_month" : filter === "yearly" ? "this_year" : filter === "custom" ? "custom" : "today";
  return rangeBounds(key, customFrom, customTo, now);
}

function doctorLiveAppointments(patient: DeskPatient, doctorId: string) {
  return patient.appointments.filter((item) => item.doctor_id === doctorId && !["cancelled", "no_show"].includes(item.status));
}

function doctorUpcomingAppointments(patient: DeskPatient, doctorId: string) {
  const endToday = new Date();
  endToday.setHours(24, 0, 0, 0);
  return doctorLiveAppointments(patient, doctorId)
    .filter((item) => new Date(item.starts_at).getTime() >= endToday.getTime() && !["completed"].includes(item.status))
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
}

function doctorPatientInFilter(patient: DeskPatient, doctorId: string, filter: DoctorFilter, customFrom: string, customTo: string) {
  const mine = doctorLiveAppointments(patient, doctorId);
  if (mine.length === 0) return false;
  if (filter === "upcoming") return doctorUpcomingAppointments(patient, doctorId).length > 0;
  const bounds = doctorFilterBounds(filter, customFrom, customTo);
  const from = new Date(bounds.from).getTime();
  const to = new Date(bounds.to).getTime();
  return mine.some((item) => {
    const time = new Date(item.starts_at).getTime();
    return time >= from && time < to;
  });
}

function doctorVisitForFilter(patient: DeskPatient, doctorId: string, filter: DoctorFilter, customFrom: string, customTo: string) {
  const mine = doctorLiveAppointments(patient, doctorId);
  if (filter === "upcoming") return doctorUpcomingAppointments(patient, doctorId)[0] ?? null;
  const bounds = doctorFilterBounds(filter, customFrom, customTo);
  const from = new Date(bounds.from).getTime();
  const to = new Date(bounds.to).getTime();
  return mine
    .filter((item) => {
      const time = new Date(item.starts_at).getTime();
      return time >= from && time < to;
    })
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at))[0] ?? null;
}


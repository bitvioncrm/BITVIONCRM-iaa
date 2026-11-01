import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BusinessBoard } from "@/components/dashboard/BusinessBoard";
import { Sheet, SheetBody, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useDesk } from "@/context/DeskContext";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { loadDoctorPulse, loadRecentPatients } from "@/services/clinic-care";
import { formatClock } from "@/lib/call-time";
import { rangeBounds, type RangeKey } from "@/lib/range";
import { callDeskReport, countRows, listAppointments, listDeskPatients, listDeskStudents, listFollowUps, type DeskPatient, type DeskStudent } from "@/services/production-ops";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
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
  const { workspaces, error } = useWorkspaces();
  const clinic = workspaces.find((item) => item.workspaceType === "clinic") ?? workspaces[0];
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [pulse, setPulse] = useState({ consulted: 0, patients: 0, pending: 0, units: 0, days: [] as Array<{ day: string; sold: number }> });
  const [registered, setRegistered] = useState<Array<{ id: string; patient_code: string; full_name: string; mobile: string }>>([]);
  useEffect(() => {
    if (!clinic) return;
    const bounds = rangeBounds(range, customFrom, customTo);
    void loadDoctorPulse(clinic.id, bounds.fromDate, bounds.toDate, bounds.from, bounds.to).then(setPulse).catch(() => setPulse({ consulted: 0, patients: 0, pending: 0, units: 0, days: [] }));
    void loadRecentPatients(clinic.id).then(setRegistered).catch(() => setRegistered([]));
  }, [clinic, range, customFrom, customTo]);
  return (
    <Shell title="Doctor">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {([["today", "Today"], ["7d", "Weekly"], ["this_month", "Monthly"], ["this_year", "Yearly"], ["custom", "Custom"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`rounded-md border px-3 py-2 text-sm ${range === key ? "border-navy bg-navy text-white" : "border-line bg-white"}`} onClick={() => setRange(key)}>{label}</button>
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
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Patients registered at reception</h2>
        {registered.length === 0 ? <p className="mt-2 text-sm text-muted">No patients registered yet.</p> : registered.map((patient) => (
          <p key={patient.id} className="mt-2 text-sm">{patient.patient_code} · {patient.full_name} · {patient.mobile}</p>
        ))}
      </section>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Products sold per day</h2>
        {pulse.days.length === 0 ? <p className="mt-2 text-sm text-muted">No products sold in this range.</p> : pulse.days.map((row) => (
          <p key={row.day} className="mt-2 text-sm">{row.day} · {row.sold} sold</p>
        ))}
      </section>
    </Shell>
  );
}

function ReceptionDashboard() {
  const { workspaces, error } = useWorkspaces();
  const clinic = workspaces.find((item) => item.workspaceType === "clinic") ?? workspaces[0];
  const [appointments, setAppointments] = useState<Array<{ id: string; starts_at: string; status: string; reason: string }>>([]);
  const [patients, setPatients] = useState(0);
  const [cards, setCards] = useState<DeskPatient[]>([]);
  const [filter, setFilter] = useState<DeskFilter>("yearly");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [open, setOpen] = useState<DeskPatient | null>(null);
  useEffect(() => {
    if (!clinic) return;
    void listAppointments(clinic.id).then((rows) => setAppointments(rows as typeof appointments)).catch(() => setAppointments([]));
    void countRows("patients", clinic.id).then(setPatients);
    void listDeskPatients(clinic.id).then(setCards).catch(() => setCards([]));
  }, [clinic]);
  const visible = useMemo(() => cards.filter((patient) => patientMatches(patient, filter, customFrom, customTo)), [cards, filter, customFrom, customTo]);
  return (
    <Shell title="Reception">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Patients" value={String(patients)} />
        <Stat label="Appointments" value={String(appointments.length)} />
        <Stat label="Arrived" value={String(appointments.filter((item) => item.status === "arrived").length)} />
      </div>
      <div className="flex flex-wrap gap-2"><Tile to="/clinic" label="Register and appointments" /><Tile to="/billing" label="Income and expenses" /><Tile to="/inventory" label="Stock" /></div>
      <FilterBar filter={filter} customFrom={customFrom} customTo={customTo} onFilter={setFilter} onFrom={setCustomFrom} onTo={setCustomTo} count={visible.length} noun="patients" />
      {visible.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No patients in this range.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((patient) => {
            const next = nextAppointment(patient);
            return (
              <button key={patient.id} type="button" onClick={() => setOpen(patient)} className="rounded-2xl border border-line bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#c6a15b] hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0e1420] text-sm font-semibold text-[#e8d5a3]">{initials(patient.full_name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">{patient.full_name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{patient.patient_code}</span>
                  </span>
                  {next ? <StatusChip status={next.status} /> : null}
                </div>
                <p className="mt-3 text-sm text-ink">{patient.mobile || "No mobile"}</p>
                <p className="mt-1 text-xs text-muted">{next ? `${formatWhen(next.starts_at)}${next.reason ? ` · ${next.reason}` : ""}` : `Registered ${formatWhen(patient.created_at)}`}</p>
              </button>
            );
          })}
        </div>
      )}
      <Sheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpen(null); }}>
        {open ? (
          <SheetContent title={open.full_name}>
            <SheetHeader>
              <p className="text-xs font-medium tracking-wide text-[#a6843d] uppercase">{open.patient_code}</p>
              <h2 className="mt-1 text-xl font-semibold">{open.full_name}</h2>
              <p className="mt-1 text-sm text-muted">{open.mobile || "No mobile"}{open.place ? ` · ${open.place}` : ""}</p>
            </SheetHeader>
            <SheetBody className="space-y-4">
              <DetailGrid rows={[
                ["Gender", open.gender],
                ["Date of birth", open.date_of_birth || ""],
                ["Age", open.age == null ? "" : String(open.age)],
                ["Email", open.email],
                ["Address", open.address],
                ["Emergency contact", open.emergency_contact],
                ["Registered", formatWhen(open.created_at)],
              ]} />
              {open.notes ? <p className="rounded-xl bg-[#faf6ee] px-3 py-2 text-sm">{open.notes}</p> : null}
              <div>
                <h3 className="text-sm font-semibold">Bookings</h3>
                {open.appointments.length === 0 ? <p className="mt-2 text-sm text-muted">No appointments yet.</p> : open.appointments.map((item) => (
                  <div key={item.id} className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                    <span>{formatWhen(item.starts_at)}{item.reason ? ` · ${item.reason}` : ""}</span>
                    <StatusChip status={item.status} />
                  </div>
                ))}
              </div>
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
  const [filter, setFilter] = useState<DeskFilter>("yearly");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [open, setOpen] = useState<DeskStudent | null>(null);
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
                <button key={student.id} type="button" onClick={() => setOpen(student)} className="rounded-2xl border border-line bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#c6a15b] hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0e1420] text-sm font-semibold text-[#e8d5a3]">{initials(student.full_name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{student.full_name}</span>
                      <span className="mt-0.5 block text-xs text-muted">{student.student_code}</span>
                    </span>
                    <StatusChip status={student.status} />
                  </div>
                  <p className="mt-3 text-sm text-ink">{student.mobile || "No mobile"}</p>
                  <p className="mt-1 text-xs text-muted">{student.course || "No course"}{student.admission_date ? ` · Admitted ${student.admission_date}` : ""}</p>
                </button>
              ))}
            </div>
          )}
          <Sheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpen(null); }}>
            {open ? (
              <SheetContent title={open.full_name}>
                <SheetHeader>
                  <p className="text-xs font-medium tracking-wide text-[#a6843d] uppercase">{open.student_code}</p>
                  <h2 className="mt-1 text-xl font-semibold">{open.full_name}</h2>
                  <p className="mt-1 text-sm text-muted">{open.course || "No course"}</p>
                </SheetHeader>
                <SheetBody>
                  <DetailGrid rows={[
                    ["Status", open.status],
                    ["Mobile", open.mobile],
                    ["Email", open.email],
                    ["Gender", open.gender],
                    ["Date of birth", open.date_of_birth || ""],
                    ["Address", open.address],
                    ["Admission", open.admission_date || ""],
                    ["Registered", formatWhen(open.created_at)],
                  ]} />
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

type DeskFilter = "today" | "yesterday" | "appointment_today" | "upcoming" | "weekly" | "monthly" | "yearly" | "custom";

const FILTERS: Array<{ key: DeskFilter; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "appointment_today", label: "Appointment today" },
  { key: "upcoming", label: "Upcoming bookings" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
  { key: "custom", label: "Custom" },
];

function FilterBar({ filter, customFrom, customTo, onFilter, onFrom, onTo, count, noun, labels }: {
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
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button key={item.key} type="button" onClick={() => onFilter(item.key)} className={`rounded-full px-3 py-1.5 text-sm ${filter === item.key ? "bg-[#0e1420] text-[#e8d5a3]" : "border border-line bg-white text-ink"}`}>
            {labels?.[item.key] ?? item.label}
          </button>
        ))}
        {filter === "custom" ? (
          <>
            <input type="date" aria-label="From" className="rounded-full border border-line bg-white px-3 py-1.5 text-sm" value={customFrom} onChange={(event) => onFrom(event.target.value)} />
            <input type="date" aria-label="To" className="rounded-full border border-line bg-white px-3 py-1.5 text-sm" value={customTo} onChange={(event) => onTo(event.target.value)} />
          </>
        ) : null}
      </div>
      <p className="text-sm text-muted">{count.toLocaleString("en-IN")} {noun}</p>
    </div>
  );
}

function boundsFor(filter: DeskFilter, customFrom: string, customTo: string) {
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

function patientMatches(patient: DeskPatient, filter: DeskFilter, customFrom: string, customTo: string) {
  const span = boundsFor(filter, customFrom, customTo);
  const live = patient.appointments.filter((item) => item.status !== "cancelled");
  if (filter === "appointment_today") return live.some((item) => inside(item.starts_at, span.from, span.to));
  if (filter === "upcoming") return live.some((item) => new Date(item.starts_at).getTime() >= span.from.getTime() && !["completed", "no_show"].includes(item.status));
  return inside(patient.created_at, span.from, span.to) || live.some((item) => inside(item.starts_at, span.from, span.to));
}

function studentMatches(student: DeskStudent, filter: DeskFilter, customFrom: string, customTo: string) {
  const span = boundsFor(filter, customFrom, customTo);
  const stamp = student.admission_date ? `${student.admission_date}T00:00:00` : student.created_at;
  if (filter === "upcoming") return student.status === "enquiry" || student.status === "admitted";
  if (filter === "appointment_today") return inside(stamp, span.from, span.to);
  return inside(stamp, span.from, span.to) || inside(student.created_at, span.from, span.to);
}

function nextAppointment(patient: DeskPatient) {
  return [...patient.appointments].sort((left, right) => right.starts_at.localeCompare(left.starts_at))[0];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "•";
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

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.filter(([, value]) => value.trim()).map(([label, value]) => (
        <div key={label} className="rounded-xl border border-line px-3 py-2">
          <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</dt>
          <dd className="mt-1 text-sm text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

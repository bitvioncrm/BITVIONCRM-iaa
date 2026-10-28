import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BusinessBoard } from "@/components/dashboard/BusinessBoard";
import { useAuth } from "@/context/AuthContext";
import { useDesk } from "@/context/DeskContext";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { loadDoctorPulse } from "@/services/clinic-care";
import { formatClock } from "@/lib/call-time";
import { rangeBounds, type RangeKey } from "@/lib/range";
import { callDeskReport, countRows, listAppointments, listFollowUps, listPatients } from "@/services/production-ops";

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
  const [registered, setRegistered] = useState<Array<{ id: string; full_name: string; mobile: string; patient_code: string }>>([]);
  useEffect(() => {
    if (!clinic) return;
    const bounds = rangeBounds(range, customFrom, customTo);
    void loadDoctorPulse(clinic.id, bounds.fromDate, bounds.toDate, bounds.from, bounds.to).then(setPulse).catch(() => setPulse({ consulted: 0, patients: 0, pending: 0, units: 0, days: [] }));
    void listPatients(clinic.id, "").then((rows) => setRegistered(rows as typeof registered)).catch(() => setRegistered([]));
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
        <h2 className="text-sm font-semibold">Patients from reception</h2>
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
  useEffect(() => {
    if (!clinic) return;
    void listAppointments(clinic.id).then((rows) => setAppointments(rows as typeof appointments)).catch(() => setAppointments([]));
    void countRows("patients", clinic.id).then(setPatients);
  }, [clinic]);
  return (
    <Shell title="Reception">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Patients" value={String(patients)} />
        <Stat label="Appointments" value={String(appointments.length)} />
        <Stat label="Arrived" value={String(appointments.filter((item) => item.status === "arrived").length)} />
      </div>
      <div className="flex flex-wrap gap-2"><Tile to="/clinic" label="Register and appointments" /><Tile to="/billing" label="Income and expenses" /><Tile to="/inventory" label="Stock" /></div>
    </Shell>
  );
}

function CallerDashboard({ title, institute }: { title: string; institute: boolean }) {
  const { workspaces, error } = useWorkspaces();
  const workspace = workspaces.find((item) => item.workspaceType === (institute ? "institute" : "clinic")) ?? workspaces[0];
  const [leads, setLeads] = useState(0);
  const [followups, setFollowups] = useState(0);
  const [calls, setCalls] = useState({ dials: "0", connected: "0", rejected: "0", talk: "0:00" });
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
  }, [workspace]);
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
    </Shell>
  );
}

function ClinicCallerDashboard() {
  return <CallerDashboard title="Clinic telecaller" institute={false} />;
}

function InstituteCallerDashboard() {
  return <CallerDashboard title="Institute telecaller" institute />;
}

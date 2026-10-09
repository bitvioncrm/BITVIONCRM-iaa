import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BusinessBoard } from "@/components/dashboard/BusinessBoard";
import { useAuth } from "@/context/AuthContext";
import { useDesk } from "@/context/DeskContext";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { callSummary, countRows, listAppointments, listFollowUps, listProducts } from "@/services/production-ops";

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

function Shell({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{detail}</p>
      </div>
      {children}
    </div>
  );
}

export function ProductionDashboard() {
  const { productionUser } = useAuth();
  const key = productionUser?.roleKey ?? "";
  if (key === "doctor") return <DoctorDashboard />;
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
  const [appointments, setAppointments] = useState<Array<{ id: string; starts_at: string; status: string; reason: string }>>([]);
  const [lowStock, setLowStock] = useState(0);
  useEffect(() => {
    if (!clinic) return;
    void listAppointments(clinic.id).then((rows) => setAppointments(rows as typeof appointments)).catch(() => setAppointments([]));
    void listProducts(clinic.id).then((rows) => setLowStock(rows.filter((row) => Number(row.current_stock) <= Number(row.minimum_stock)).length)).catch(() => setLowStock(0));
  }, [clinic]);
  const today = new Date().toISOString().slice(0, 10);
  const todays = appointments.filter((item) => String(item.starts_at).slice(0, 10) === today);
  return (
    <Shell title="Doctor" detail="Today's clinic queue, consultations, and stock you can adjust. WhatsApp is view only.">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Today's appointments" value={String(todays.length)} />
        <Stat label="Queue" value={String(appointments.filter((item) => item.status === "arrived" || item.status === "in_consultation").length)} />
        <Stat label="Low stock" value={String(lowStock)} />
      </div>
      <div className="flex flex-wrap gap-2"><Tile to="/clinic" label="Patients and consultations" /><Tile to="/inventory" label="Stock" /><Tile to="/whatsapp" label="View WhatsApp" /></div>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Today</h2>
        {todays.length === 0 ? <p className="mt-2 text-sm text-muted">No appointments loaded for today.</p> : todays.map((item) => <p key={item.id} className="mt-2 text-sm">{item.starts_at} · {item.status} · {item.reason}</p>)}
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
    <Shell title="Reception" detail="Patients and appointments. Billing is not on this desk. WhatsApp is view only.">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Patients" value={String(patients)} />
        <Stat label="Appointments" value={String(appointments.length)} />
        <Stat label="Arrived" value={String(appointments.filter((item) => item.status === "arrived").length)} />
      </div>
      <div className="flex flex-wrap gap-2"><Tile to="/clinic" label="Register and appointments" /><Tile to="/whatsapp" label="View WhatsApp" /></div>
    </Shell>
  );
}

function CallerDashboard({ title, detail, institute }: { title: string; detail: string; institute: boolean }) {
  const { workspaces, error } = useWorkspaces();
  const workspace = workspaces.find((item) => item.workspaceType === (institute ? "institute" : "clinic")) ?? workspaces[0];
  const [leads, setLeads] = useState(0);
  const [followups, setFollowups] = useState(0);
  const [calls, setCalls] = useState("—");
  useEffect(() => {
    if (!workspace) return;
    void countRows("leads", workspace.id).then(setLeads);
    void listFollowUps(workspace.id).then((rows) => setFollowups(rows.filter((row) => row.status === "pending").length)).catch(() => setFollowups(0));
    void callSummary(workspace.id).then((row) => setCalls(`${Math.round(row.today / 60)} min`)).catch(() => setCalls("—"));
  }, [workspace]);
  return (
    <Shell title={title} detail={detail}>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Leads" value={String(leads)} />
        <Stat label="Pending follow-ups" value={String(followups)} />
        <Stat label="Today's call time" value={calls} />
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
  return <CallerDashboard title="Clinic telecaller" detail="Assigned clinic leads, follow-ups, and call time. WhatsApp is view only. Admin sends messages." institute={false} />;
}

function InstituteCallerDashboard() {
  return <CallerDashboard title="Institute telecaller" detail="Institute leads, admissions, documents, and certificates. WhatsApp is view only. Admin sends messages." institute />;
}

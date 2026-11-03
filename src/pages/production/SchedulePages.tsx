import { useEffect, useMemo, useState } from "react";
import { Portrait } from "@/components/shared/Portrait";
import { DialLink } from "@/components/calls/DialLink";
import { phoneTel } from "@/lib/phone";
import { listDoctors, listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import {
  addAppointmentFollowUp,
  createAppointment,
  listDeskAppointments,
  listDeskPatients,
  listDeskStudents,
  listFollowUps,
  removeAppointment,
  rescheduleFollowUp,
  saveStudentDetails,
  updateAppointment,
  type DeskAppointmentRow,
  type DeskPatient,
  type DeskStudent,
} from "@/services/production-ops";
import { detailsFromStudent } from "@/components/institute/StudentForm";

const APPOINTMENT_FILTERS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
] as const;

const STATUSES = ["scheduled", "confirmed", "arrived", "in_consultation", "completed", "cancelled", "no_show"];

type WhenFilter = (typeof APPOINTMENT_FILTERS)[number]["key"];

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function matchesWhen(iso: string, filter: WhenFilter) {
  if (filter === "all" || !iso) return filter === "all";
  const time = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();
  if (Number.isNaN(time)) return false;
  const start = startOfDay();
  const endToday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
  if (filter === "today") return time >= start.getTime() && time < endToday;
  if (filter === "upcoming") return time >= endToday;
  if (filter === "weekly") {
    const monday = new Date(start);
    monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return time >= monday.getTime() && time < monday.getTime() + 7 * 86400000;
  }
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
  return time >= monthStart && time < monthEnd;
}

function formatWhen(iso: string) {
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: iso.includes("T") ? "numeric" : undefined, minute: iso.includes("T") ? "2-digit" : undefined });
}

function localInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function Chips({ value, onChange }: { value: WhenFilter; onChange: (value: WhenFilter) => void }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {APPOINTMENT_FILTERS.map((item) => (
        <button key={item.key} type="button" onClick={() => onChange(item.key)} className={`min-h-11 shrink-0 rounded-full px-3.5 text-sm ${value === item.key ? "bg-[#0e1420] text-[#e8d5a3]" : "border border-line bg-white text-ink"}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function useDesk(type: "clinic" | "institute") {
  const [workspace, setWorkspace] = useState<WorkspaceOption | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void listWorkspaces()
      .then((rows) => setWorkspace(rows.find((item) => item.workspaceType === type) ?? rows[0] ?? null))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not open this desk"));
  }, [type]);
  return { workspace, error, setError };
}

export function AppointmentsPage() {
  const { workspace, error, setError } = useDesk("clinic");
  const [rows, setRows] = useState<DeskAppointmentRow[]>([]);
  const [patients, setPatients] = useState<DeskPatient[]>([]);
  const [doctors, setDoctors] = useState<Array<{ userId: string; name: string }>>([]);
  const [filter, setFilter] = useState<WhenFilter>("all");
  const [notice, setNotice] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [walkIn, setWalkIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = (id: string) => {
    void listDeskAppointments(id).then(setRows).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load appointments"));
  };
  useEffect(() => {
    if (!workspace) return;
    load(workspace.id);
    void listDeskPatients(workspace.id).then(setPatients).catch(() => setPatients([]));
    void listDoctors(workspace.id).then(setDoctors).catch(() => setDoctors([]));
  }, [workspace]);
  const visible = useMemo(() => rows.filter((row) => matchesWhen(row.startsAt, filter)), [rows, filter]);
  const doctorName = (id: string) => doctors.find((item) => item.userId === id)?.name || "";
  const book = () => {
    if (!workspace || !patientId || !when) return;
    setSaving(true);
    void createAppointment({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      patientId,
      doctorId: doctorId || null,
      startsAt: new Date(when).toISOString(),
      reason,
      status: walkIn ? "arrived" : "scheduled",
    }).then(() => {
      setNotice("Appointment saved.");
      setReason("");
      setWhen("");
      load(workspace.id);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the appointment")).finally(() => setSaving(false));
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <p className="mt-1 text-sm text-muted">{visible.length.toLocaleString("en-IN")} in this range</p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      <form className="grid gap-2 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); book(); }}>
        <label className="text-sm">Patient
          <select required value={patientId} onChange={(event) => setPatientId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
            <option value="">Choose a patient</option>
            {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name}</option>)}
          </select>
        </label>
        <label className="text-sm">Doctor
          <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
            <option value="">No doctor yet</option>
            {doctors.map((doctor) => <option key={doctor.userId} value={doctor.userId}>{doctor.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Date and time
          <input required type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" />
        </label>
        <label className="text-sm">Reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={walkIn} onChange={(event) => setWalkIn(event.target.checked)} /> Mark arrived now</label>
        <button type="submit" disabled={saving} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:col-span-2">{saving ? "Saving" : "Save appointment"}</button>
      </form>
      <Chips value={filter} onChange={setFilter} />
      {visible.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No appointments in this range.</p> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((row) => (
            <article key={row.id} className="touch-card space-y-3 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-lg font-semibold">{row.patientName}</p>
                  <p className="mt-1 text-sm">{row.patientMobile || "No mobile"}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#faf6ee] px-2 py-1 text-[11px] font-medium capitalize text-[#8a6a2f]">{statusLabel(row.status)}</span>
              </div>
              <p className="text-sm">{formatWhen(row.startsAt)}{row.reason ? ` · ${row.reason}` : ""}{doctorName(row.doctorId) ? ` · ${doctorName(row.doctorId)}` : ""}</p>
              <label className="block text-sm">Status
                <select value={row.status} onChange={(event) => {
                  const status = event.target.value;
                  void updateAppointment(row.id, { status }).then(() => { if (workspace) load(workspace.id); setNotice("Appointment updated."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not update the appointment"));
                }} className="mt-1 h-11 w-full rounded-md border border-line px-3 capitalize">
                  {STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                </select>
              </label>
              <label className="block text-sm">Move the time
                <input type="datetime-local" defaultValue={localInput(row.startsAt)} onBlur={(event) => {
                  if (!event.target.value || !workspace) return;
                  void updateAppointment(row.id, { startsAt: new Date(event.target.value).toISOString() }).then(() => { load(workspace.id); setNotice("Appointment moved."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not move the appointment"));
                }} className="mt-1 h-11 w-full rounded-md border border-line px-3" />
              </label>
              <div className="flex flex-wrap gap-3">
                {workspace && phoneTel(row.patientMobile) ? <DialLink organizationId={workspace.organizationId} workspaceId={workspace.id} name={row.patientName} phone={row.patientMobile} /> : null}
                <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                  if (!window.confirm(`Delete the appointment for ${row.patientName}?`)) return;
                  void removeAppointment(row.id).then(() => { if (workspace) load(workspace.id); setNotice("Appointment deleted."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not delete the appointment"));
                }}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function BookingsPage() {
  const { workspace, error, setError } = useDesk("institute");
  const [students, setStudents] = useState<DeskStudent[]>([]);
  const [followUps, setFollowUps] = useState<Array<{ id: string; lead_id: string; due_at: string; status: string; notes: string }>>([]);
  const [filter, setFilter] = useState<WhenFilter>("all");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { status: string; bookedOn: string; appointmentAt: string }>>({});
  useEffect(() => {
    if (!workspace) return;
    void listDeskStudents(workspace.id).then((rows) => {
      setStudents(rows);
      setDrafts(Object.fromEntries(rows.map((student) => [student.id, { status: student.status || "enquiry", bookedOn: student.admission_date || "", appointmentAt: "" }])));
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load bookings"));
    void listFollowUps(workspace.id).then((rows) => {
      setFollowUps(rows);
      setDrafts((current) => {
        const next = { ...current };
        for (const studentId of Object.keys(next)) {
          const student = students.find((item) => item.id === studentId);
          const visit = rows.find((row) => student && row.lead_id === student.lead_id && row.status === "pending");
          if (visit && !next[studentId].appointmentAt) next[studentId] = { ...next[studentId], appointmentAt: localInput(visit.due_at) };
        }
        return next;
      });
    }).catch(() => setFollowUps([]));
  }, [workspace]);
  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const student of students) {
        const visit = followUps.find((row) => row.lead_id === student.lead_id && row.status === "pending");
        if (!next[student.id]) {
          next[student.id] = { status: student.status || "enquiry", bookedOn: student.admission_date || "", appointmentAt: visit ? localInput(visit.due_at) : "" };
          changed = true;
        } else if (visit && !next[student.id].appointmentAt) {
          next[student.id] = { ...next[student.id], appointmentAt: localInput(visit.due_at) };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [students, followUps]);
  const visible = useMemo(() => students.filter((student) => {
    const draft = drafts[student.id];
    const stamp = draft?.appointmentAt || student.admission_date || student.created_at;
    if (filter === "all") return true;
    if (filter === "upcoming") return student.status === "booked" || student.status === "enquiry" || matchesWhen(stamp, "upcoming");
    return matchesWhen(stamp, filter);
  }), [drafts, filter, students]);
  const save = (student: DeskStudent) => {
    if (!workspace) return;
    const draft = drafts[student.id];
    if (!draft) return;
    setSavingId(student.id);
    const details = { ...detailsFromStudent(student), status: draft.status, admissionDate: draft.bookedOn || null };
    void saveStudentDetails(student.id, workspace.organizationId, workspace.id, details, { settle: false }).then(async () => {
      const visit = followUps.find((row) => row.lead_id === student.lead_id && row.status === "pending");
      if (draft.appointmentAt && visit) await rescheduleFollowUp(visit.id, new Date(draft.appointmentAt).toISOString());
      else if (draft.appointmentAt && student.lead_id) await addAppointmentFollowUp({ organizationId: workspace.organizationId, workspaceId: workspace.id, leadId: student.lead_id, dueAt: new Date(draft.appointmentAt).toISOString(), fullName: student.full_name });
      const [nextStudents, nextFollows] = await Promise.all([listDeskStudents(workspace.id), listFollowUps(workspace.id)]);
      setStudents(nextStudents);
      setFollowUps(nextFollows);
      setNotice(`${student.full_name} saved.`);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the booking")).finally(() => setSavingId(""));
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <p className="mt-1 text-sm text-muted">{visible.length.toLocaleString("en-IN")} students</p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      <Chips value={filter} onChange={setFilter} />
      {visible.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No bookings in this range.</p> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((student) => {
            const draft = drafts[student.id] ?? { status: student.status, bookedOn: student.admission_date || "", appointmentAt: "" };
            return (
              <article key={student.id} className="touch-card space-y-3 rounded-2xl border border-line bg-white p-4">
                <div className="flex items-start gap-3">
                  <Portrait name={student.full_name} path={student.photo_path} />
                  <div className="min-w-0">
                    <p className="break-words text-lg font-semibold">{student.full_name}</p>
                    <p className="text-xs text-muted">{student.student_code}</p>
                    <p className="mt-1 text-sm">{student.mobile || "No mobile"}{student.course ? ` · ${student.course}` : ""}</p>
                  </div>
                </div>
                <label className="block text-sm">Status
                  <select value={draft.status} onChange={(event) => setDrafts({ ...drafts, [student.id]: { ...draft, status: event.target.value } })} className="mt-1 h-11 w-full rounded-md border border-line px-3">
                    <option value="enquiry">Enquiry</option>
                    <option value="booked">Booked</option>
                    <option value="admitted">Admitted</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
                <label className="block text-sm">Booked date
                  <input type="date" value={draft.bookedOn} onChange={(event) => setDrafts({ ...drafts, [student.id]: { ...draft, bookedOn: event.target.value } })} className="mt-1 h-11 w-full rounded-md border border-line px-3" />
                </label>
                <label className="block text-sm">Appointment
                  <input type="datetime-local" value={draft.appointmentAt} onChange={(event) => setDrafts({ ...drafts, [student.id]: { ...draft, appointmentAt: event.target.value } })} className="mt-1 h-11 w-full rounded-md border border-line px-3" />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={savingId === student.id} onClick={() => save(student)} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white">{savingId === student.id ? "Saving" : "Save booking"}</button>
                  {workspace && phoneTel(student.mobile) ? <DialLink organizationId={workspace.organizationId} workspaceId={workspace.id} leadId={student.lead_id || null} name={student.full_name} phone={student.mobile} /> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

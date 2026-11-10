import type { DeskPatient } from "@/services/production-ops";
import { rangeBounds, type RangeKey } from "@/lib/range";

export type DoctorFilter = "today" | "upcoming" | "previous" | "weekly" | "monthly" | "yearly" | "custom";

export const DOCTOR_FILTERS: Array<{ key: DoctorFilter; label: string }> = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "previous", label: "Previous" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
  { key: "custom", label: "Custom" },
];

export function startOfLocalDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function endOfLocalDay(now = new Date()) {
  const start = startOfLocalDay(now);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
}

function stampMs(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function patientAssignedToDoctor(patient: DeskPatient, doctorId: string) {
  if (!doctorId) return false;
  return patient.appointments.some((item) => item.doctor_id === doctorId);
}

export function doctorLiveAppointments(patient: DeskPatient, doctorId: string) {
  return patient.appointments.filter((item) => item.doctor_id === doctorId && !["cancelled", "no_show"].includes(item.status));
}

export function doctorUpcomingAppointments(patient: DeskPatient, doctorId: string, now = new Date()) {
  const cutoff = endOfLocalDay(now).getTime();
  return doctorLiveAppointments(patient, doctorId)
    .filter((item) => stampMs(item.starts_at) >= cutoff && item.status !== "completed")
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
}

/** Any completed visit or recorded care counts as consulted. */
export function patientWasConsulted(patient: DeskPatient) {
  if (patient.treatments.length > 0) return true;
  return patient.appointments.some((item) => item.status === "completed");
}

function consultationStamps(patient: DeskPatient) {
  const stamps: number[] = [];
  for (const treatment of patient.treatments) {
    const time = stampMs(treatment.performed_on);
    if (time) stamps.push(time);
  }
  for (const appointment of patient.appointments) {
    if (appointment.status === "completed") {
      const time = stampMs(appointment.starts_at);
      if (time) stamps.push(time);
    }
  }
  return stamps;
}

/** Consulted evidence strictly before local start of today. */
export function patientHistoricallyConsulted(patient: DeskPatient, now = new Date()) {
  const cutoff = startOfLocalDay(now).getTime();
  return consultationStamps(patient).some((time) => time < cutoff);
}

/** Assigned visits from local start of today onward (includes today + future). */
export function doctorAssignedFromToday(patient: DeskPatient, doctorId: string, now = new Date()) {
  const cutoff = startOfLocalDay(now).getTime();
  return doctorLiveAppointments(patient, doctorId).some((item) => stampMs(item.starts_at) >= cutoff);
}

export function doctorDeskPool(patients: DeskPatient[], doctorId: string, now = new Date()) {
  return patients.filter((patient) => patientHistoricallyConsulted(patient, now) || doctorAssignedFromToday(patient, doctorId, now));
}

export function doctorFilterBounds(filter: DoctorFilter, customFrom: string, customTo: string, now = new Date()) {
  const start = startOfLocalDay(now);
  const endToday = endOfLocalDay(now);
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
  if (filter === "previous") {
    return {
      from: new Date(2000, 0, 1).toISOString(),
      to: start.toISOString(),
      fromDate: "2000-01-01",
      toDate: new Date(start.getTime() - 1).toISOString().slice(0, 10),
      label: "Previous",
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

function historyInRange(patient: DeskPatient, from: number, to: number, todayStart: number) {
  const historyTo = Math.min(to, todayStart);
  if (historyTo <= from) return false;
  return consultationStamps(patient).some((time) => time >= from && time < historyTo);
}

function assignedInRange(patient: DeskPatient, doctorId: string, from: number, to: number, todayStart: number) {
  const assignedFrom = Math.max(from, todayStart);
  if (to <= assignedFrom) return false;
  return doctorLiveAppointments(patient, doctorId).some((item) => {
    const time = stampMs(item.starts_at);
    return time >= assignedFrom && time < to;
  });
}

export function doctorPatientInFilter(
  patient: DeskPatient,
  doctorId: string,
  filter: DoctorFilter,
  customFrom: string,
  customTo: string,
  now = new Date(),
) {
  if (filter === "upcoming") return doctorUpcomingAppointments(patient, doctorId, now).length > 0;
  if (filter === "previous") return patientHistoricallyConsulted(patient, now);

  const bounds = doctorFilterBounds(filter, customFrom, customTo, now);
  const from = stampMs(bounds.from);
  const to = stampMs(bounds.to);
  const todayStart = startOfLocalDay(now).getTime();

  if (filter === "today") {
    return doctorLiveAppointments(patient, doctorId).some((item) => {
      const time = stampMs(item.starts_at);
      return time >= from && time < to;
    });
  }

  return historyInRange(patient, from, to, todayStart) || assignedInRange(patient, doctorId, from, to, todayStart);
}

export function doctorVisitForFilter(
  patient: DeskPatient,
  doctorId: string,
  filter: DoctorFilter,
  customFrom: string,
  customTo: string,
  now = new Date(),
) {
  if (filter === "upcoming") return doctorUpcomingAppointments(patient, doctorId, now)[0] ?? null;
  if (filter === "previous") {
    return [...patient.appointments]
      .filter((item) => item.status === "completed" && stampMs(item.starts_at) < startOfLocalDay(now).getTime())
      .sort((left, right) => right.starts_at.localeCompare(left.starts_at))[0] ?? null;
  }
  const bounds = doctorFilterBounds(filter, customFrom, customTo, now);
  const from = stampMs(bounds.from);
  const to = stampMs(bounds.to);
  const todayStart = startOfLocalDay(now).getTime();
  const mine = doctorLiveAppointments(patient, doctorId)
    .filter((item) => {
      const time = stampMs(item.starts_at);
      return time >= Math.max(from, todayStart) && time < to;
    })
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
  if (mine[0]) return mine[0];
  return [...patient.appointments]
    .filter((item) => {
      const time = stampMs(item.starts_at);
      return item.status === "completed" && time >= from && time < Math.min(to, todayStart);
    })
    .sort((left, right) => right.starts_at.localeCompare(left.starts_at))[0] ?? null;
}

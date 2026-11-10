const ADMIN = ["/", "/desk", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp", "/tasks", "/reports", "/team", "/activity", "/settings", "/clinic", "/institute", "/institute-billing", "/inventory", "/billing", "/meta", "/backups"];

const CLINIC_DOCTOR_ROLES = new Set(["doctor", "duty_doctor", "doctor_bhama"]);

export function isClinicDoctor(roleKey: string) {
  return CLINIC_DOCTOR_ROLES.has(roleKey);
}

export function canOperateWhatsApp(roleKey: string) {
  return roleKey === "super_admin" || roleKey === "admin";
}

export const WHATSAPP_BULK_ADMIN_LIMIT = 50;

export function canWriteWhatsApp(roleKey: string) {
  return canOperateWhatsApp(roleKey) || deskCallerRoles("clinic").includes(roleKey) || deskCallerRoles("institute").includes(roleKey);
}

export function whatsAppDesk(roleKey: string) {
  if (canOperateWhatsApp(roleKey)) return "both";
  if (isClinicDoctor(roleKey) || roleKey === "receptionist" || deskCallerRoles("clinic").includes(roleKey)) return "clinic";
  if (deskCallerRoles("institute").includes(roleKey)) return "institute";
  return "none";
}

export function canSendBulk(roleKey: string, count: number) {
  if (count < 1) return false;
  return canOperateWhatsApp(roleKey);
}

export function pathsForRole(roleKey: string) {
  if (canOperateWhatsApp(roleKey)) return ADMIN;
  if (isClinicDoctor(roleKey)) return ["/", "/clinic", "/inventory"];
  if (roleKey === "receptionist") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/clinic", "/appointments", "/inventory", "/billing"];
  if (roleKey === "clinic_telecaller" || roleKey === "clinic_bde") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp", "/appointments"];
  if (roleKey === "institute_telecaller" || roleKey === "institute_bde" || roleKey === "institute_user") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp", "/institute", "/institute-billing", "/bookings"];
  return ["/"];
}

export function roleAllowsPath(roleKey: string, pathname: string) {
  return pathsForRole(roleKey).some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)));
}

export function deskCallerRoles(workspaceType: string) {
  if (workspaceType === "clinic") return ["clinic_telecaller", "clinic_bde"];
  if (workspaceType === "institute") return ["institute_telecaller", "institute_bde", "institute_user"];
  return [];
}

export function deskAssigneeRoles(workspaceType: string) {
  if (workspaceType === "clinic") return ["receptionist", ...deskCallerRoles("clinic")];
  return deskCallerRoles(workspaceType);
}

export function productionRoleLabel(roleKey: string) {
  if (roleKey === "super_admin" || roleKey === "admin") return "Admin";
  if (roleKey === "doctor") return "Doctor Rimisha";
  if (roleKey === "duty_doctor") return "Doctor Siji";
  if (roleKey === "doctor_bhama") return "Doctor Bhama";
  if (roleKey === "receptionist") return "Receptionist";
  if (roleKey === "clinic_telecaller" || roleKey === "clinic_bde") return "Clinic Telecaller";
  if (roleKey === "institute_telecaller" || roleKey === "institute_bde" || roleKey === "institute_user") return "Institute Telecaller";
  return "Staff";
}

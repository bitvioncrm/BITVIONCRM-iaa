const ADMIN = ["/", "/desk", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp", "/tasks", "/reports", "/team", "/activity", "/settings", "/clinic", "/institute", "/inventory", "/billing", "/meta"];

export function canOperateWhatsApp(roleKey: string) {
  return roleKey === "super_admin" || roleKey === "admin";
}

export const WHATSAPP_BULK_ADMIN_LIMIT = 50;

export function canWriteWhatsApp(roleKey: string) {
  return canOperateWhatsApp(roleKey) || deskCallerRoles("clinic").includes(roleKey) || deskCallerRoles("institute").includes(roleKey);
}

export function whatsAppDesk(roleKey: string) {
  if (canOperateWhatsApp(roleKey)) return "both";
  if (roleKey === "doctor" || roleKey === "duty_doctor" || roleKey === "receptionist" || deskCallerRoles("clinic").includes(roleKey)) return "clinic";
  if (deskCallerRoles("institute").includes(roleKey)) return "institute";
  return "none";
}

export function canSendBulk(roleKey: string, count: number) {
  if (count < 1) return false;
  return canWriteWhatsApp(roleKey) || (count > WHATSAPP_BULK_ADMIN_LIMIT && canOperateWhatsApp(roleKey));
}

export function pathsForRole(roleKey: string) {
  if (canOperateWhatsApp(roleKey)) return ADMIN;
  if (roleKey === "doctor" || roleKey === "duty_doctor") return ["/", "/clinic", "/inventory"];
  if (roleKey === "receptionist") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/clinic", "/inventory", "/billing"];
  if (roleKey === "clinic_telecaller" || roleKey === "clinic_bde") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp"];
  if (roleKey === "institute_telecaller" || roleKey === "institute_bde" || roleKey === "institute_user") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp", "/institute"];
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
  if (roleKey === "doctor") return "Doctor";
  if (roleKey === "duty_doctor") return "Duty doctor";
  if (roleKey === "receptionist") return "Receptionist";
  if (roleKey === "clinic_telecaller" || roleKey === "clinic_bde") return "Clinic Telecaller";
  if (roleKey === "institute_telecaller" || roleKey === "institute_bde" || roleKey === "institute_user") return "Institute Telecaller";
  return "Staff";
}

const ADMIN = ["/", "/desk", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp", "/campaigns", "/templates", "/tasks", "/reports", "/team", "/activity", "/settings", "/clinic", "/institute", "/inventory", "/billing"];

export function canOperateWhatsApp(roleKey: string) {
  return roleKey === "super_admin" || roleKey === "admin";
}

export function pathsForRole(roleKey: string) {
  if (canOperateWhatsApp(roleKey)) return ADMIN;
  if (roleKey === "doctor") return ["/", "/clinic", "/inventory", "/whatsapp"];
  if (roleKey === "receptionist") return ["/", "/clinic", "/whatsapp"];
  if (roleKey === "clinic_telecaller" || roleKey === "clinic_bde") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp"];
  if (roleKey === "institute_telecaller" || roleKey === "institute_bde" || roleKey === "institute_user") return ["/", "/leads", "/pipeline", "/follow-ups", "/calls", "/whatsapp", "/institute"];
  return ["/"];
}

export function roleAllowsPath(roleKey: string, pathname: string) {
  return pathsForRole(roleKey).some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)));
}

export function productionRoleLabel(roleKey: string) {
  if (roleKey === "super_admin" || roleKey === "admin") return "Admin";
  if (roleKey === "doctor") return "Doctor";
  if (roleKey === "receptionist") return "Receptionist";
  if (roleKey === "clinic_telecaller" || roleKey === "clinic_bde") return "Clinic Telecaller";
  if (roleKey === "institute_telecaller" || roleKey === "institute_bde" || roleKey === "institute_user") return "Institute Telecaller";
  return "Staff";
}

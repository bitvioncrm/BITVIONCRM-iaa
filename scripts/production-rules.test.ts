import { automationDecision, rangeForPreset } from "../src/lib/production-rules.ts";
import { pathsForRole, roleAllowsPath, canOperateWhatsApp, deskCallerRoles } from "../src/lib/production-access.ts";

const today = rangeForPreset("today", new Date("2026-10-07T12:00:00+05:30"));
if (today.from !== today.to) throw new Error("today range");
const yesterday = rangeForPreset("yesterday", new Date("2026-10-07T12:00:00+05:30"));
if (yesterday.from === today.from) throw new Error("yesterday");
if (automationDecision({ replied: true, tokenConfigured: true }) !== "stopped") throw new Error("stop on reply");
if (automationDecision({ replied: false, tokenConfigured: false }) !== "configuration_required") throw new Error("missing token");
if (automationDecision({ replied: false, tokenConfigured: true }) !== "send") throw new Error("send");
if (roleAllowsPath("doctor", "/institute")) throw new Error("doctor institute");
if (!roleAllowsPath("clinic_bde", "/leads")) throw new Error("bde leads");
if (pathsForRole("institute_user").includes("/clinic")) throw new Error("institute clinic");
if (!pathsForRole("super_admin").includes("/billing")) throw new Error("super billing");
if (pathsForRole("receptionist").includes("/billing")) throw new Error("receptionist billing");
if (pathsForRole("doctor").includes("/billing")) throw new Error("doctor billing");
if (!canOperateWhatsApp("admin") || canOperateWhatsApp("doctor") || canOperateWhatsApp("receptionist") || canOperateWhatsApp("clinic_telecaller") || canOperateWhatsApp("institute_telecaller")) {
  throw new Error("whatsapp operate");
}
if (!roleAllowsPath("institute_telecaller", "/institute")) throw new Error("institute desk");
if (roleAllowsPath("clinic_telecaller", "/clinic")) throw new Error("clinic caller patients");
const clinicCallers = deskCallerRoles("clinic");
const instituteCallers = deskCallerRoles("institute");
if (!clinicCallers.includes("clinic_telecaller") || clinicCallers.some((role) => instituteCallers.includes(role))) {
  throw new Error("clinic callers must stay separate from institute callers");
}
if (!instituteCallers.includes("institute_telecaller") || deskCallerRoles("billing").length) {
  throw new Error("institute callers");
}

console.log("production rules ok");

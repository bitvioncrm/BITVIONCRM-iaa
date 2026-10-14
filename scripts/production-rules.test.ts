import { outcomeFromPhoneReturn, summarizeCalls } from "../src/lib/call-time.ts";
import { automationDecision, rangeForPreset } from "../src/lib/production-rules.ts";
import { pathsForRole, roleAllowsPath, canOperateWhatsApp, canSendBulk, canWriteWhatsApp, deskCallerRoles, WHATSAPP_BULK_ADMIN_LIMIT } from "../src/lib/production-access.ts";

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
if (!canWriteWhatsApp("clinic_telecaller") || !canWriteWhatsApp("institute_telecaller") || canWriteWhatsApp("doctor") || canWriteWhatsApp("receptionist")) {
  throw new Error("whatsapp write");
}
if (!canSendBulk("clinic_telecaller", WHATSAPP_BULK_ADMIN_LIMIT) || canSendBulk("institute_telecaller", WHATSAPP_BULK_ADMIN_LIMIT + 1) || !canSendBulk("admin", WHATSAPP_BULK_ADMIN_LIMIT + 1)) {
  throw new Error("bulk over 50 is admin only");
}

const calls = summarizeCalls([
  { status: "completed", outcome: "connected", duration_seconds: 90 },
  { status: "completed", outcome: "rejected", duration_seconds: 0 },
  { status: "completed", outcome: "no_answer", duration_seconds: 0 },
  { status: "interrupted", outcome: null, duration_seconds: null },
]);
if (calls.dials !== 3 || calls.connected !== 1 || calls.rejected !== 1 || calls.noAnswer !== 1 || calls.talkSeconds !== 90) {
  throw new Error("call totals");
}
if (outcomeFromPhoneReturn(14) !== "rejected" || outcomeFromPhoneReturn(15) !== "connected") throw new Error("phone return");

console.log("production rules ok");

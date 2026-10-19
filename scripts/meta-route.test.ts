import { readFileSync } from "node:fs";
import { resolveFormMapping, resolveLeadDesk } from "../src/lib/meta-route.ts";

const clinic = { formId: "111", pageId: "900", workspaceId: "clinic-ws", organizationId: "org", active: true };
const institute = { formId: "222", pageId: "900", workspaceId: "institute-ws", organizationId: "org", active: true };

const clinicMatch = resolveFormMapping("111", "900", [clinic, institute]);
if (clinicMatch?.workspaceId !== "clinic-ws") throw new Error("clinic form was not routed to the clinic workspace");

const instituteMatch = resolveFormMapping("222", "900", [clinic, institute]);
if (instituteMatch?.workspaceId !== "institute-ws") throw new Error("institute form was not routed to the institute workspace");

if (resolveFormMapping("111", "900", [clinic, { ...clinic, workspaceId: "other" }])) {
  throw new Error("ambiguous form mappings must not pick a desk");
}

if (resolveFormMapping("111", "900", [{ ...clinic, active: false }])) {
  throw new Error("inactive mappings must not route a lead");
}

if (resolveFormMapping("111", "other-page", [clinic])) {
  throw new Error("a page mismatch must not route a lead");
}

if (resolveFormMapping("", "900", [clinic])) throw new Error("a missing form id must not route a lead");

if (resolveFormMapping("333", "900", [clinic, institute])) throw new Error("an unmapped form must not guess a desk");

const accounts = [
  { adAccountId: "act_111", workspaceId: "clinic-ws", organizationId: "org" },
  { adAccountId: "222", workspaceId: "institute-ws", organizationId: "org" },
];
const clinicCampaign = resolveLeadDesk({ formId: "", pageId: "", adAccountId: "111", mappings: [], accounts });
if (clinicCampaign?.workspaceId !== "clinic-ws" || clinicCampaign.reason !== "ad_account") throw new Error("clinic ads account must receive every clinic campaign");
const instituteCampaign = resolveLeadDesk({ formId: "unused", pageId: "", adAccountId: "act_222", mappings: [], accounts });
if (instituteCampaign?.workspaceId !== "institute-ws") throw new Error("institute ads account must stay separate");
if (resolveLeadDesk({ formId: "", pageId: "", adAccountId: "999", mappings: [], accounts })) throw new Error("unknown ads account must not guess a desk");
if (resolveLeadDesk({ formId: "", pageId: "", adAccountId: "111", mappings: [], accounts: [...accounts, { adAccountId: "act_111", workspaceId: "other", organizationId: "org" }] })) {
  throw new Error("a shared ads account must not pick a desk");
}
const formWins = resolveLeadDesk({ formId: "222", pageId: "900", adAccountId: "111", mappings: [institute], accounts });
if (formWins?.workspaceId !== "institute-ws" || formWins.reason !== "form") throw new Error("an explicit form mapping must override the ads account");

const ingest = readFileSync(new URL("../netlify/lib/meta-ingest.ts", import.meta.url), "utf8");
if (ingest.includes("META_WORKSPACE_ID")) throw new Error("webhook still sends every lead to one workspace");
if (!ingest.includes("resolveLeadDesk")) throw new Error("webhook does not apply form or ads-account routing");
if (ingest.includes("console.log")) throw new Error("webhook logs request data");

console.log("meta route ok");

import { messageBody, phoneLookup, whatsappLeadFields } from "../netlify/lib/whatsapp-inbound.ts";

const phone = phoneLookup("919567429928");
if (phone.full !== "919567429928" || phone.tail !== "9567429928" || phone.display !== "+919567429928") {
  throw new Error("phone lookup failed");
}

const fields = whatsappLeadFields({ name: "Asha", from: "919567429928", headline: "DRK Botox" });
if (fields.source !== "whatsapp_click" || fields.source_platform !== "whatsapp" || fields.status !== "new") {
  throw new Error("click leads must stay out of the Excel sheet");
}
if (fields.source_campaign !== "DRK Botox" || fields.full_name !== "Asha") throw new Error("campaign name missing");
const named = whatsappLeadFields({ name: "Asha", from: "919567429928", headline: "DRK Botox", campaign: "IAA Kochi" });
if (named.source_campaign !== "IAA Kochi") throw new Error("ad campaign should replace the headline");

const blank = whatsappLeadFields({ name: "  ", from: "918592861517" });
if (blank.full_name !== "WhatsApp lead") throw new Error("missing name should still create a lead");

if (messageBody("Hi", "Lip filler") !== "Hi\nAd: Lip filler") throw new Error("message body should keep the ad headline");

console.log("whatsapp inbound ok");

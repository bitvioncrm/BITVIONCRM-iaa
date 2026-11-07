import { listLeads } from "@/services/production-leads";
import { uploadPrivateFile } from "@/services/production-ops";
import { supabase } from "@/lib/supabase";

function client() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

export interface WhatsAppChat {
  id: string;
  fullName: string;
  phone: string;
  workspaceId: string;
  createdAt: string;
  preview: string;
}

export interface WhatsAppBubble {
  id: string;
  body: string;
  direction: string;
  status: string;
  createdAt: string;
}

export interface WhatsAppPoster {
  id: string;
  filename: string;
  url: string;
}

export async function listWhatsAppChats(workspaceId: string, search: string, scope: "clicks" | "all" = "clicks", page = 1) {
  const result = await listLeads({
    page,
    workspaceId: workspaceId || undefined,
    search,
    ...(scope === "clicks" ? { origin: "live" as const, source: "whatsapp_click" } : {}),
  });
  const ids = result.leads.map((lead) => lead.id);
  const preview = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await client()
      .from("messages")
      .select("lead_id, body, created_at")
      .eq("channel", "whatsapp")
      .in("lead_id", ids)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const leadId = String(row.lead_id ?? "");
      if (leadId && !preview.has(leadId)) preview.set(leadId, String(row.body ?? ""));
    }
  }
  return {
    total: result.total,
    chats: result.leads.map((lead) => ({
      id: lead.id,
      fullName: lead.fullName,
      phone: lead.phone,
      workspaceId: lead.workspaceId,
      createdAt: lead.createdAt,
      preview: preview.get(lead.id) ?? "",
    })) satisfies WhatsAppChat[],
  };
}

export async function listWhatsAppThread(leadId: string) {
  const { data, error } = await client()
    .from("messages")
    .select("id, body, direction, status, created_at")
    .eq("channel", "whatsapp")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    body: String(row.body ?? ""),
    direction: String(row.direction ?? ""),
    status: String(row.status ?? ""),
    createdAt: String(row.created_at ?? ""),
  })) satisfies WhatsAppBubble[];
}

export async function listWhatsAppPosters(workspaceId: string) {
  const { data, error } = await client()
    .from("documents")
    .select("id, filename, storage_path")
    .eq("workspace_id", workspaceId)
    .eq("entity_type", "whatsapp_poster")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const posters: WhatsAppPoster[] = [];
  for (const row of data ?? []) {
    const path = String(row.storage_path ?? "");
    const signed = path ? await client().storage.from("documents").createSignedUrl(path, 60 * 60 * 6) : { data: null };
    posters.push({ id: String(row.id), filename: String(row.filename ?? "Poster"), url: signed.data?.signedUrl ?? "" });
  }
  return posters;
}

export async function saveWhatsAppPoster(workspace: { id: string; organizationId: string }, file: File) {
  await uploadPrivateFile({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    entityType: "whatsapp_poster",
    entityId: workspace.id,
    file,
    category: "marketing",
  });
}

export function dayStart(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

export function nextDayStart(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export async function countWhatsAppRecipients(workspaceId: string, filters: { from: string; to: string; name: string }) {
  const result = await listLeads({
    page: 1,
    workspaceId,
    search: filters.name,
    createdFrom: filters.from ? dayStart(filters.from) : undefined,
    createdTo: filters.to ? nextDayStart(filters.to) : undefined,
  });
  return { total: result.total, pages: result.pages };
}

export interface WhatsAppNumber {
  workspaceId: string;
  name: string;
  workspaceType: string;
  displayPhone: string;
}

export async function listWhatsAppNumbers() {
  const { data, error } = await client().rpc("list_whatsapp_numbers");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    workspaceId: String(row.workspace_id),
    name: String(row.workspace_name ?? ""),
    workspaceType: String(row.workspace_type ?? ""),
    displayPhone: String(row.display_phone ?? ""),
  })) satisfies WhatsAppNumber[];
}

export async function saveWhatsAppNumber(workspaceId: string, displayPhone: string) {
  const { error } = await client().rpc("save_whatsapp_number", { p_workspace: workspaceId, p_display_phone: displayPhone.trim() });
  if (error) throw new Error(error.message);
}

async function readFunctionJson(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    if (/<!doctype html|<html/i.test(raw)) {
      throw new Error("WhatsApp send timed out on the live server. Try Send again — it continues from the last lead.");
    }
    throw new Error(raw.slice(0, 160) || "WhatsApp send failed.");
  }
}

export interface WhatsAppSendResult {
  leadId: string;
  phone: string;
  name: string;
  status: "sent" | "failed" | "skipped";
  detail: string;
}

export async function sendWhatsAppBulk(input: { text: string; imageUrl?: string; workspaceId?: string; offset: number; campaignId?: string }) {
  const session = await client().auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Sign in again before sending.");
  const response = await fetch("/.netlify/functions/whatsapp-bulk", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readFunctionJson(response);
  if (!response.ok) throw new Error(String(body.detail || body.status || "Bulk send failed"));
  const next = Number(body.next ?? input.offset);
  const total = Number(body.total ?? 0);
  const results = Array.isArray(body.results)
    ? (body.results as Array<Record<string, unknown>>).map((row) => ({
        leadId: String(row.leadId ?? ""),
        phone: String(row.phone ?? ""),
        name: String(row.name ?? "Lead"),
        status: (row.status === "sent" || row.status === "skipped" ? row.status : "failed") as WhatsAppSendResult["status"],
        detail: String(row.detail ?? ""),
      }))
    : [];
  return {
    sent: Number(body.sent ?? 0),
    failed: Number(body.failed ?? 0),
    next,
    total,
    done: next >= total,
    capped: body.status === "capped" || Number(body.capped ?? 0) === 1,
    detail: String(body.detail ?? ""),
    results,
  };
}

export async function listWhatsAppCampaignSends(campaignId: string, status: "all" | "sent" | "failed" | "skipped" = "all") {
  let query = client()
    .from("whatsapp_campaign_sends")
    .select("id, lead_id, phone, lead_name, status, detail, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    leadId: String(row.lead_id ?? ""),
    phone: String(row.phone ?? ""),
    name: String(row.lead_name ?? "Lead"),
    status: (row.status === "sent" || row.status === "skipped" ? row.status : "failed") as WhatsAppSendResult["status"],
    detail: String(row.detail ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
}

export const WHATSAPP_DAILY_CAP = 250;

export interface WhatsAppCampaign {
  id: string;
  workspaceId: string;
  name: string;
  body: string;
  posterId: string;
  status: "draft" | "running" | "completed";
  sent: number;
  failed: number;
  total: number;
  cursor: number;
}

function indiaDayStart() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

export async function countWhatsAppSentToday(workspaceId: string) {
  const { count, error } = await client()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("channel", "whatsapp")
    .eq("direction", "outbound")
    .gte("created_at", indiaDayStart());
  if (error) throw new Error(error.message);
  const sent = count ?? 0;
  return { sent, balance: Math.max(0, WHATSAPP_DAILY_CAP - sent), cap: WHATSAPP_DAILY_CAP };
}

async function profileToken() {
  const session = await client().auth.getSession();
  return session.data.session?.access_token ?? "";
}

export async function loadWhatsAppProfile(workspaceId = "") {
  const token = await profileToken();
  if (!token) return { name: "", phone: "", pictureUrl: "" };
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const response = await fetch(`/.netlify/functions/whatsapp-profile${query}`, { headers: { authorization: `Bearer ${token}` } });
  const body = (await response.json().catch(() => ({}))) as { name?: string; phone?: string; pictureUrl?: string; detail?: string };
  if (!response.ok && body.detail) throw new Error(body.detail);
  return { name: body.name ?? "", phone: body.phone ?? "", pictureUrl: body.pictureUrl ?? "" };
}

export async function saveWhatsAppProfilePicture(file: File, workspaceId = "") {
  const token = await profileToken();
  if (!token) throw new Error("Sign in again before updating the profile photo.");
  const body = new FormData();
  body.set("file", file);
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const response = await fetch(`/.netlify/functions/whatsapp-profile${query}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
  const payload = (await response.json().catch(() => ({}))) as { name?: string; phone?: string; pictureUrl?: string; detail?: string; status?: string };
  if (!response.ok) throw new Error(payload.detail || payload.status || "Could not update the WhatsApp photo.");
  return { name: payload.name ?? "", phone: payload.phone ?? "", pictureUrl: payload.pictureUrl ?? "" };
}

export async function removeWhatsAppPoster(id: string) {
  const { error } = await client().from("documents").delete().eq("id", id).eq("entity_type", "whatsapp_poster");
  if (error) throw new Error(error.message);
}

export async function listWhatsAppCampaigns(workspaceId: string) {
  const { data, error } = await client()
    .from("whatsapp_campaigns")
    .select("id, workspace_id, name, body, poster_path, status, sent_count, failed_count, total_count, cursor_offset")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name ?? ""),
    body: String(row.body ?? ""),
    posterId: String(row.poster_path ?? ""),
    status: (row.status === "running" || row.status === "completed" ? row.status : "draft") as WhatsAppCampaign["status"],
    sent: Number(row.sent_count ?? 0),
    failed: Number(row.failed_count ?? 0),
    total: Number(row.total_count ?? 0),
    cursor: Number(row.cursor_offset ?? 0),
  })) satisfies WhatsAppCampaign[];
}

export async function saveWhatsAppCampaign(input: {
  id?: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  body: string;
  posterId: string;
  status: WhatsAppCampaign["status"];
  sent: number;
  failed: number;
  total: number;
  cursor: number;
}) {
  const row = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    name: input.name.trim() || "CRM broadcast",
    body: input.body,
    poster_path: input.posterId,
    status: input.status,
    sent_count: input.sent,
    failed_count: input.failed,
    total_count: input.total,
    cursor_offset: input.cursor,
    updated_at: new Date().toISOString(),
  };
  const query = input.id
    ? client().from("whatsapp_campaigns").update(row).eq("id", input.id).select("id").single()
    : client().from("whatsapp_campaigns").insert(row).select("id").single();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function removeWhatsAppCampaign(id: string) {
  const { error } = await client().from("whatsapp_campaigns").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function sendWhatsAppMessage(input: {
  leadId?: string;
  to: string;
  text: string;
  bulkSize: number;
  imageUrl?: string;
  workspaceId?: string;
  test?: boolean;
}) {
  const session = await client().auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Sign in again before sending.");
  const response = await fetch("/.netlify/functions/whatsapp-send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readFunctionJson(response);
  if (!response.ok) return String(body.detail || body.status || "Could not send");
  if (body.detail && body.status !== "sent") return String(body.detail);
  return String(body.detail || body.status || "sent");
}

export async function sendWhatsAppTest(input: { workspaceId: string; to: string; text: string; imageUrl?: string }) {
  return sendWhatsAppMessage({
    to: input.to,
    text: input.text,
    bulkSize: 1,
    imageUrl: input.imageUrl,
    workspaceId: input.workspaceId,
    test: true,
  });
}

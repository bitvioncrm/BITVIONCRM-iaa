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

export async function listWhatsAppChats(workspaceId: string, search: string) {
  const result = await listLeads({ page: 1, workspaceId, search });
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
    const signed = path ? await client().storage.from("documents").createSignedUrl(path, 60 * 30) : { data: null };
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

export async function sendWhatsAppMessage(input: { leadId: string; to: string; text: string; bulkSize: number }) {
  const session = await client().auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Sign in again before sending.");
  const response = await fetch("/.netlify/functions/whatsapp-send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { status?: string };
  return body.status ?? "request_failed";
}

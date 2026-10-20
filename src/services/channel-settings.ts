import { supabase } from "@/lib/supabase";

function db() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

export interface ChannelStatus {
  workspaceId: string;
  workspaceName: string;
  workspaceType: string;
  organizationId: string;
  channel: "meta" | "whatsapp";
  appId: string;
  pageId: string;
  phoneNumberId: string;
  displayPhone: string;
  wabaId: string;
  adAccountId: string;
  accessTokenSet: boolean;
  appSecretSet: boolean;
  verifyTokenSet: boolean;
  verifyToken: string;
  accessTokenLast4: string;
  status: string;
  detail: string;
  lastCheckedAt: string | null;
  updatedAt: string | null;
}

export interface ChannelDraft {
  workspaceId: string;
  channel: "meta" | "whatsapp";
  appId: string;
  pageId: string;
  phoneNumberId: string;
  displayPhone: string;
  wabaId: string;
  adAccountId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export async function listWorkspaceChannels() {
  const { data, error } = await db().rpc("list_workspace_channels");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name ?? ""),
    workspaceType: String(row.workspace_type ?? ""),
    organizationId: String(row.organization_id),
    channel: row.channel === "whatsapp" ? "whatsapp" : "meta",
    appId: String(row.app_id ?? ""),
    pageId: String(row.page_id ?? ""),
    phoneNumberId: String(row.phone_number_id ?? ""),
    displayPhone: String(row.display_phone ?? ""),
    wabaId: String(row.waba_id ?? ""),
    adAccountId: String(row.ad_account_id ?? ""),
    accessTokenSet: Boolean(row.access_token_set),
    appSecretSet: Boolean(row.app_secret_set),
    verifyTokenSet: Boolean(row.verify_token_set),
    verifyToken: String(row.verify_token ?? ""),
    accessTokenLast4: String(row.access_token_last4 ?? ""),
    status: String(row.status ?? "configuration_required"),
    detail: String(row.detail ?? ""),
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  })) satisfies ChannelStatus[];
}

export async function saveWorkspaceChannel(input: ChannelDraft) {
  const { error } = await db().rpc("save_workspace_channel", {
    p_workspace: input.workspaceId,
    p_channel: input.channel,
    p_app_id: input.appId.trim(),
    p_page_id: input.pageId.trim(),
    p_phone_number_id: input.phoneNumberId.trim(),
    p_display_phone: input.displayPhone.trim(),
    p_waba_id: input.wabaId.trim(),
    p_ad_account_id: input.adAccountId.trim(),
    p_access_token: input.accessToken.trim(),
    p_app_secret: input.appSecret.trim(),
    p_verify_token: input.verifyToken.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function testWorkspaceChannel(workspaceId: string, channel: "meta" | "whatsapp") {
  const session = await db().auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Sign in again before testing the connection.");
  const response = await fetch("/.netlify/functions/channel-test", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, channel }),
  });
  const body = (await response.json().catch(() => ({}))) as { status?: string; detail?: string };
  if (!response.ok) throw new Error(body.detail || "Connection test failed. Deploy the site so the test function is available.");
  return body.detail || "Connected.";
}

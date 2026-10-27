export interface ChannelSecret {
  organization_id: string;
  workspace_id: string;
  channel: "meta" | "whatsapp";
  app_id: string;
  page_id: string;
  phone_number_id: string;
  display_phone: string;
  waba_id: string;
  access_token: string;
  app_secret: string;
  verify_token: string;
  ad_account_id: string;
}

function headers(serviceKey: string) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

export async function loadChannelSecrets(supabaseUrl: string, serviceKey: string, channel?: "meta" | "whatsapp") {
  const filter = channel ? `&channel=eq.${channel}` : "";
  const response = await fetch(
    `${supabaseUrl}/rest/v1/workspace_channel_secrets?select=organization_id,workspace_id,channel,app_id,page_id,phone_number_id,display_phone,waba_id,access_token,app_secret,verify_token,ad_account_id${filter}`,
    { headers: headers(serviceKey) },
  );
  if (!response.ok) return [] as ChannelSecret[];
  const rows = (await response.json()) as ChannelSecret[];
  return Array.isArray(rows) ? rows : [];
}

export function sendingLine(rows: ChannelSecret[]) {
  const ready = rows.filter((row) => row.phone_number_id);
  const clinic = ready.find((row) => row.display_phone.replace(/\D/g, "").endsWith("9562429928") || row.phone_number_id === "1347562095115257");
  return clinic ?? ready[0];
}

export function tokenCandidates(line: ChannelSecret | undefined, meta: ChannelSecret[]) {
  const sameDesk = meta.filter((row) => row.workspace_id === line?.workspace_id);
  const rest = meta.filter((row) => row.workspace_id !== line?.workspace_id);
  return uniqueSecrets([line?.access_token ?? "", ...sameDesk.map((row) => row.access_token), ...rest.map((row) => row.access_token)]);
}

export async function rememberWhatsAppToken(supabaseUrl: string, serviceKey: string, workspaceId: string, accessToken: string, detail: string) {
  await fetch(`${supabaseUrl}/rest/v1/workspace_channel_secrets?workspace_id=eq.${workspaceId}&channel=eq.whatsapp`, {
    method: "PATCH",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ access_token: accessToken, status: "connected", detail, updated_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }),
  });
}

export function uniqueSecrets(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

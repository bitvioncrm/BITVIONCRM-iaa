import { supabase } from "@/lib/supabase";
import type { WorkspaceOption } from "@/services/production-leads";

export interface CampaignPulseRow {
  campaign: string;
  desk: string;
  workspaceId: string;
  total: number;
  fresh: number;
  contacted: number;
  converted: number;
  unassigned: number;
  lastAt: string;
  hot: boolean;
  action: string;
}

function db() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

function deskLabel(workspaces: WorkspaceOption[], workspaceId: string) {
  const row = workspaces.find((item) => item.id === workspaceId);
  if (!row) return "Desk";
  return row.workspaceType === "institute" ? "Institute" : "Clinic";
}

function actionFor(row: { total: number; fresh: number; contacted: number; converted: number; unassigned: number; hot: boolean }) {
  if (row.unassigned > 0) return `Assign ${row.unassigned} waiting`;
  if (row.fresh > 0 && row.contacted === 0) return "Call the new leads";
  if (row.fresh > 3 && row.converted === 0) return "Follow up today";
  if (row.hot) return "Keep ads running";
  if (row.converted > 0) return "Scale this campaign";
  if (row.total >= 5) return "Improve the offer creatives";
  return "Watch for new leads";
}

/** Live Meta form + WhatsApp click pulse by campaign — skips the Excel queue. */
export async function loadCampaignPulse(workspaces: WorkspaceOption[], workspaceIds: string[], from: string, to: string) {
  if (!workspaceIds.length) return [] as CampaignPulseRow[];
  const { data, error } = await db()
    .from("leads")
    .select("id, status, source, source_platform, source_campaign, workspace_id, created_at, assigned_to")
    .in("workspace_id", workspaceIds)
    .is("deleted_at", null)
    .or("source_platform.eq.meta,source.eq.meta_ads,source.eq.whatsapp_click")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const map = new Map<string, CampaignPulseRow & { _sort: number }>();
  for (const row of data ?? []) {
    const campaign = String(row.source_campaign || "").trim() || (row.source === "whatsapp_click" ? "WhatsApp click" : "Unnamed campaign");
    const workspaceId = String(row.workspace_id);
    const key = `${workspaceId}::${campaign}`;
    const current = map.get(key) ?? {
      campaign,
      desk: deskLabel(workspaces, workspaceId),
      workspaceId,
      total: 0,
      fresh: 0,
      contacted: 0,
      converted: 0,
      unassigned: 0,
      lastAt: String(row.created_at),
      hot: false,
      action: "",
      _sort: 0,
    };
    current.total += 1;
    const status = String(row.status);
    if (status === "new") current.fresh += 1;
    if (status === "contacted" || status === "interested" || status === "follow_up") current.contacted += 1;
    if (status === "converted") current.converted += 1;
    if (!row.assigned_to && status === "new") current.unassigned += 1;
    const at = new Date(String(row.created_at)).getTime();
    if (at > current._sort) {
      current._sort = at;
      current.lastAt = String(row.created_at);
    }
    if (at >= dayAgo) current.hot = true;
    map.set(key, current);
  }

  return [...map.values()]
    .map(({ _sort, ...row }) => ({ ...row, action: actionFor(row) }))
    .sort((a, b) => b.total - a.total || b.lastAt.localeCompare(a.lastAt));
}

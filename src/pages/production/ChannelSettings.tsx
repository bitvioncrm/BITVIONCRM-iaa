import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listWorkspaceChannels, saveWorkspaceChannel, testWorkspaceChannel, type ChannelDraft, type ChannelStatus } from "@/services/channel-settings";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";

const META_ROWS: Array<{ key: keyof ChannelDraft; label: string; secret?: boolean; placeholder?: string }> = [
  { key: "appId", label: "App ID", placeholder: "From the Meta app" },
  { key: "pageId", label: "Facebook Page ID", placeholder: "Page that owns the lead forms" },
  { key: "adAccountId", label: "Ads account ID", placeholder: "975152708626051" },
  { key: "appSecret", label: "App secret", secret: true, placeholder: "Paste to save or replace" },
  { key: "accessToken", label: "Page access token", secret: true, placeholder: "Paste to save or replace" },
  { key: "verifyToken", label: "Webhook verify token", secret: true, placeholder: "Same phrase as in Meta" },
];

const WHATSAPP_ROWS: Array<{ key: keyof ChannelDraft; label: string; secret?: boolean; placeholder?: string }> = [
  { key: "displayPhone", label: "WhatsApp number", placeholder: "+91…" },
  { key: "phoneNumberId", label: "Phone number ID", placeholder: "From WhatsApp API setup" },
  { key: "wabaId", label: "WhatsApp Business Account ID", placeholder: "WABA ID" },
  { key: "appId", label: "App ID", placeholder: "Can match the Meta app" },
  { key: "appSecret", label: "App secret", secret: true, placeholder: "Paste to save or replace" },
  { key: "accessToken", label: "Access token", secret: true, placeholder: "Permanent WhatsApp token" },
  { key: "verifyToken", label: "Webhook verify token", secret: true, placeholder: "Same phrase as in Meta" },
];

function emptyDraft(workspaceId: string, channel: "meta" | "whatsapp"): ChannelDraft {
  return {
    workspaceId,
    channel,
    appId: "",
    pageId: "",
    phoneNumberId: "",
    displayPhone: "",
    wabaId: "",
    adAccountId: "",
    accessToken: "",
    appSecret: "",
    verifyToken: "",
  };
}

function savedFlag(row: ChannelStatus | undefined, key: keyof ChannelDraft) {
  if (!row) return false;
  if (key === "accessToken") return row.accessTokenSet;
  if (key === "appSecret") return row.appSecretSet;
  if (key === "verifyToken") return row.verifyTokenSet;
  return false;
}

function statusLabel(status?: string) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Needs attention";
  if (status === "disconnected") return "Disconnected";
  return "Not tested";
}

export function ChannelSettings({ embedded = false }: { embedded?: boolean }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ChannelDraft>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = () => {
    setLoading(true);
    void Promise.all([listWorkspaces(), listWorkspaceChannels()])
      .then(([desks, saved]) => {
        const rows = desks.filter((item) => item.workspaceType === "clinic" || item.workspaceType === "institute");
        setWorkspaces(rows);
        setChannels(saved);
        setDrafts((current) => {
          const next = { ...current };
          for (const desk of rows) {
            for (const channel of ["meta", "whatsapp"] as const) {
              const key = `${desk.id}:${channel}`;
              const savedRow = saved.find((item) => item.workspaceId === desk.id && item.channel === channel);
              const previous = current[key];
              next[key] = {
                ...emptyDraft(desk.id, channel),
                appId: savedRow?.appId || previous?.appId || "",
                pageId: savedRow?.pageId || previous?.pageId || "",
                phoneNumberId: savedRow?.phoneNumberId || previous?.phoneNumberId || "",
                displayPhone: savedRow?.displayPhone || previous?.displayPhone || "",
                wabaId: savedRow?.wabaId || previous?.wabaId || "",
                adAccountId: savedRow?.adAccountId || previous?.adAccountId || "",
                accessToken: "",
                appSecret: "",
                verifyToken: "",
              };
            }
          }
          return next;
        });
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Connections could not be loaded"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const clinic = useMemo(() => workspaces.find((item) => item.workspaceType === "clinic") ?? null, [workspaces]);
  const institute = useMemo(() => workspaces.find((item) => item.workspaceType === "institute") ?? null, [workspaces]);
  const desks = [clinic, institute].filter((item): item is WorkspaceOption => Boolean(item));

  const setField = (workspaceId: string, channel: "meta" | "whatsapp", key: keyof ChannelDraft, value: string) => {
    const id = `${workspaceId}:${channel}`;
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? emptyDraft(workspaceId, channel)), [key]: value },
    }));
  };

  const save = (workspace: WorkspaceOption, channel: "meta" | "whatsapp") => {
    const draft = drafts[`${workspace.id}:${channel}`] ?? emptyDraft(workspace.id, channel);
    const adsAccount = draft.adAccountId.trim().replace(/^act_/i, "");
    if (channel === "meta" && draft.adAccountId.trim() && !/^\d{6,20}$/.test(adsAccount)) {
      setError("Ads account ID is the number from Ads Manager, such as 975152708626051.");
      return;
    }
    const other = channel === "meta" ? drafts[`${(workspace.workspaceType === "clinic" ? institute?.id : clinic?.id) ?? ""}:meta`] : undefined;
    const otherAccount = other?.adAccountId.trim().replace(/^act_/i, "") ?? "";
    if (adsAccount && otherAccount && adsAccount === otherAccount) {
      setError("This ads account is already on the other desk. Map an institute form instead of copying the same account.");
      return;
    }
    setBusy(`${workspace.id}:${channel}`);
    setError("");
    void saveWorkspaceChannel({ ...draft, adAccountId: adsAccount })
      .then(() => {
        setNotice(`${workspace.name} ${channel === "meta" ? "Meta" : "WhatsApp"} keys saved.`);
        load();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save credentials"))
      .finally(() => setBusy(""));
  };

  const test = (workspace: WorkspaceOption, channel: "meta" | "whatsapp") => {
    setBusy(`test:${workspace.id}:${channel}`);
    setError("");
    void testWorkspaceChannel(workspace.id, channel)
      .then((detail) => {
        setNotice(detail);
        load();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Connection test failed"))
      .finally(() => setBusy(""));
  };

  const cell = (workspace: WorkspaceOption | null, channel: "meta" | "whatsapp", row: { key: keyof ChannelDraft; secret?: boolean; placeholder?: string }) => {
    if (!workspace) return <span className="text-xs text-muted">No desk</span>;
    const saved = channels.find((item) => item.workspaceId === workspace.id && item.channel === channel);
    const draft = drafts[`${workspace.id}:${channel}`];
    const value = String(draft?.[row.key] ?? "");
    return (
      <div>
        <Input
          value={value}
          type={row.secret ? "password" : "text"}
          autoComplete="off"
          placeholder={savedFlag(saved, row.key) ? "Saved" : row.placeholder}
          onChange={(event) => setField(workspace.id, channel, row.key, event.target.value)}
        />
        {row.secret && savedFlag(saved, row.key) ? <p className="mt-1 text-[11px] text-emerald-700">Saved{row.key === "accessToken" && saved?.accessTokenLast4 ? ` · ends ${saved.accessTokenLast4}` : ""}</p> : null}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {embedded ? null : (
        <header>
          <p className="text-xs font-medium tracking-wide text-accent uppercase">Admin</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Meta and WhatsApp</h1>
        </header>
      )}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{notice}</p> : null}

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">Connection columns</h2>
        </div>
        {loading ? <p className="px-4 py-6 text-sm text-muted">Loading connection columns…</p> : null}
        {!loading && desks.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No clinic or institute desk is available for this login.</p> : null}
        {!loading && desks.length > 0 ? (
          <>
            <div className="space-y-6 p-4 lg:hidden">
              {[clinic, institute].filter((item): item is WorkspaceOption => Boolean(item)).map((desk) => (
                <section key={desk.id} className="space-y-3 rounded-lg border border-line p-3">
                  <h3 className="text-sm font-semibold">{desk.workspaceType === "institute" ? "Institute" : "Clinic"} · {desk.name}</h3>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">Meta leads</p>
                  {META_ROWS.map((row) => (
                    <label key={`${desk.id}-meta-${row.key}`} className="block text-xs text-muted">
                      {row.label}
                      <div className="mt-1">{cell(desk, "meta", row)}</div>
                    </label>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={busy !== ""} onClick={() => save(desk, "meta")}>{busy === `${desk.id}:meta` ? "Saving…" : "Save Meta"}</Button>
                    <Button type="button" variant="secondary" disabled={busy !== ""} onClick={() => test(desk, "meta")}>Test Meta</Button>
                  </div>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">WhatsApp</p>
                  {WHATSAPP_ROWS.map((row) => (
                    <label key={`${desk.id}-wa-${row.key}`} className="block text-xs text-muted">
                      {row.label}
                      <div className="mt-1">{cell(desk, "whatsapp", row)}</div>
                    </label>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={busy !== ""} onClick={() => save(desk, "whatsapp")}>{busy === `${desk.id}:whatsapp` ? "Saving…" : "Save WhatsApp"}</Button>
                    <Button type="button" variant="secondary" disabled={busy !== ""} onClick={() => test(desk, "whatsapp")}>Test WhatsApp</Button>
                  </div>
                </section>
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-canvas text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="w-56 px-4 py-3 font-medium">Column</th>
                  <th className="px-4 py-3 font-medium text-ink">Clinic · {clinic?.name ?? "Missing"} · {statusLabel(channels.find((item) => item.workspaceId === clinic?.id && item.channel === "meta")?.status)}</th>
                  <th className="px-4 py-3 font-medium text-ink">Institute · {institute?.name ?? "Missing"} · {statusLabel(channels.find((item) => item.workspaceId === institute?.id && item.channel === "meta")?.status)}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line bg-slate-50"><td className="px-4 py-2 text-xs font-semibold tracking-wide uppercase" colSpan={3}>Meta leads</td></tr>
                {META_ROWS.map((row) => (
                  <tr key={`meta-${row.key}`} className="border-t border-line align-top">
                    <th className="px-4 py-3 text-left text-sm font-medium">{row.label}</th>
                    <td className="px-4 py-3">{cell(clinic, "meta", row)}</td>
                    <td className="px-4 py-3">{cell(institute, "meta", row)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <th className="px-4 py-3" />
                  <td className="px-4 py-3">
                    {clinic ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" disabled={busy !== ""} onClick={() => save(clinic, "meta")}>{busy === `${clinic.id}:meta` ? "Saving…" : "Save clinic Meta"}</Button>
                        <Button type="button" variant="secondary" disabled={busy !== ""} onClick={() => test(clinic, "meta")}>{busy === `test:${clinic.id}:meta` ? "Testing…" : "Test clinic"}</Button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {institute ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" disabled={busy !== ""} onClick={() => save(institute, "meta")}>{busy === `${institute.id}:meta` ? "Saving…" : "Save institute Meta"}</Button>
                        <Button type="button" variant="secondary" disabled={busy !== ""} onClick={() => test(institute, "meta")}>{busy === `test:${institute.id}:meta` ? "Testing…" : "Test institute"}</Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
                <tr className="border-t border-line bg-slate-50"><td className="px-4 py-2 text-xs font-semibold tracking-wide uppercase" colSpan={3}>WhatsApp numbers</td></tr>
                {WHATSAPP_ROWS.map((row) => (
                  <tr key={`wa-${row.key}`} className="border-t border-line align-top">
                    <th className="px-4 py-3 text-left text-sm font-medium">{row.label}</th>
                    <td className="px-4 py-3">{cell(clinic, "whatsapp", row)}</td>
                    <td className="px-4 py-3">{cell(institute, "whatsapp", row)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <th className="px-4 py-3" />
                  <td className="px-4 py-3">
                    {clinic ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" disabled={busy !== ""} onClick={() => save(clinic, "whatsapp")}>{busy === `${clinic.id}:whatsapp` ? "Saving…" : "Save clinic WhatsApp"}</Button>
                        <Button type="button" variant="secondary" disabled={busy !== ""} onClick={() => test(clinic, "whatsapp")}>Test clinic WhatsApp</Button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {institute ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" disabled={busy !== ""} onClick={() => save(institute, "whatsapp")}>{busy === `${institute.id}:whatsapp` ? "Saving…" : "Save institute WhatsApp"}</Button>
                        <Button type="button" variant="secondary" disabled={busy !== ""} onClick={() => test(institute, "whatsapp")}>Test institute WhatsApp</Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </>
        ) : null}
      </section>

      {embedded ? null : <p className="text-sm"><Link className="font-medium text-accent" to="/meta">Meta leads</Link></p>}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Download, HardDrive, Loader2, RefreshCw, Shield, Sparkles, Trash2, Zap } from "lucide-react";
import {
  createWorkspaceBackup,
  downloadWorkspaceBackup,
  formatBytes,
  listWorkspaceBackups,
  removeWorkspaceBackup,
  type BackupKind,
  type BackupProgress,
  type WorkspaceBackup,
} from "@/services/workspace-backups";
import type { WorkspaceOption } from "@/services/production-leads";

type Props = {
  workspaces: WorkspaceOption[];
};

const KIND_META: Record<BackupKind, { title: string; blurb: string; icon: typeof Zap }> = {
  instant: { title: "Instant backup", blurb: "Full snapshot right now — every table for this desk.", icon: Zap },
  rolling: { title: "7-day rolling", blurb: "Daily vault copies. Keeps the last 7 automatically.", icon: RefreshCw },
  alternate: { title: "Alternate safe copy", blurb: "Protected spare copy that does not rotate with daily slots.", icon: Shield },
};

const PHASES: Array<{ key: BackupProgress["phase"]; label: string }> = [
  { key: "prepare", label: "Prepare" },
  { key: "collect", label: "Collect" },
  { key: "pack", label: "Pack" },
  { key: "upload", label: "Upload" },
  { key: "finish", label: "Finish" },
  { key: "done", label: "Ready" },
];

function phaseRank(phase: BackupProgress["phase"] | undefined) {
  if (!phase || phase === "error") return -1;
  const index = PHASES.findIndex((item) => item.key === phase);
  return index < 0 ? 0 : index;
}

function daySlots(backups: WorkspaceBackup[]) {
  const rolling = backups.filter((row) => row.kind === "rolling" && row.status === "ready");
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() - index);
    const key = day.toISOString().slice(0, 10);
    const match = rolling.find((row) => row.createdAt.slice(0, 10) === key);
    return { key, label: day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }), backup: match };
  });
}

function ProgressTheatre({ progress, desk }: { progress: BackupProgress | null; desk: string }) {
  const percent = progress?.percent ?? 0;
  const running = Boolean(progress && progress.phase !== "done" && progress.phase !== "error");
  const failed = progress?.phase === "error";
  const current = phaseRank(progress?.phase);
  return (
    <div className={`relative overflow-hidden rounded-[28px] border p-5 text-white shadow-[0_24px_60px_rgba(15,28,46,0.35)] ${failed ? "border-red-300/60 bg-[linear-gradient(145deg,#3b1418_0%,#1d0f14_100%)]" : "border-[#d7b56a]/50 bg-[linear-gradient(145deg,#0f1c2e_0%,#17324f_48%,#0d1724_100%)]"} ${running ? "backup-pulse" : ""}`}>
      <div className="pointer-events-none absolute inset-0 backup-sheen" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.22em] text-[#e7c87a] uppercase">Premium vault</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">{desk} backup</h3>
          <p className="mt-2 max-w-xl text-sm text-white/70">{progress?.message || "Ready when you are. Clinic and institute vaults stay separate."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PHASES.map((phase, index) => {
              const done = current > index || progress?.phase === "done";
              const active = running && current === index;
              return (
                <span
                  key={phase.key}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${done ? "border-[#c6a15b]/50 bg-[#c6a15b]/20 text-[#f6e2a8]" : active ? "border-white/30 bg-white/10 text-white" : "border-white/10 bg-white/5 text-white/45"}`}
                >
                  {done ? <CheckCircle2 className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <Circle className="size-3.5" />}
                  {phase.label}
                </span>
              );
            })}
          </div>
        </div>
        <div className="relative grid size-28 place-items-center">
          <svg viewBox="0 0 120 120" className="size-28 -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke={failed ? "#fca5a5" : "url(#backupGold)"}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 52}`}
              strokeDashoffset={`${2 * Math.PI * 52 * (1 - percent / 100)}`}
              className="transition-[stroke-dashoffset] duration-500 ease-out"
            />
            <defs>
              <linearGradient id="backupGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f6e2a8" />
                <stop offset="100%" stopColor="#c6a15b" />
              </linearGradient>
            </defs>
          </svg>
          <span className="absolute text-lg font-semibold tabular-nums">{percent}%</span>
        </div>
      </div>
      <div className="relative mt-5 h-2.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-all duration-500 ${failed ? "bg-red-300" : "bg-[linear-gradient(90deg,#f8e7b5,#c6a15b,#8a6a2f)]"}`} style={{ width: `${percent}%` }} />
        {running ? <div className="backup-runner" /> : null}
      </div>
      {progress?.phase === "collect" ? (
        <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#e7c87a]">
          <p>
            Table {progress.tableIndex}/{progress.tableTotal}
            {progress.table ? ` · ${progress.table.replaceAll("_", " ")}` : ""}
          </p>
          <p>{progress.rows.toLocaleString("en-IN")} rows packed</p>
        </div>
      ) : null}
    </div>
  );
}

function DeskBackupCard({
  workspace,
  backups,
  busy,
  active,
  onRun,
  onDownload,
  onRemove,
}: {
  workspace: WorkspaceOption;
  backups: WorkspaceBackup[];
  busy: boolean;
  active: boolean;
  onRun: (kind: BackupKind, label?: string) => void;
  onDownload: (row: WorkspaceBackup) => void;
  onRemove: (row: WorkspaceBackup) => void;
}) {
  const desk = workspace.workspaceType === "institute" ? "Institute" : "Clinic";
  const slots = daySlots(backups);
  const alternate = backups.filter((row) => row.kind === "alternate");
  const instant = backups.filter((row) => row.kind === "instant").slice(0, 5);
  const [label, setLabel] = useState("");

  return (
    <article className={`overflow-hidden rounded-[28px] border bg-white shadow-sm transition ${active ? "border-[#c6a15b] ring-2 ring-[#c6a15b]/25" : "border-[#eadfca]"}`}>
      <div className={`px-5 py-4 ${workspace.workspaceType === "institute" ? "bg-[linear-gradient(120deg,#f7f1e4,#fff)]" : "bg-[linear-gradient(120deg,#eef6f3,#fff)]"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-[#8a6a2f] uppercase">{desk} vault</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">{workspace.name}</h3>
            <p className="mt-1 text-sm text-muted">Entire desk data — leads, people, visits, billing, stock, and channel settings (tokens redacted).</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#eadfca] bg-white px-3 py-1 text-xs font-medium text-[#8a6a2f]">
            {active ? <Loader2 className="size-3.5 animate-spin" /> : <HardDrive className="size-3.5" />}
            {active ? "Processing" : `${backups.filter((row) => row.status === "ready").length} saved`}
          </span>
        </div>
      </div>

      <div className="grid gap-4 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(KIND_META) as BackupKind[]).map((kind) => {
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <button
                key={kind}
                type="button"
                disabled={busy}
                onClick={() => onRun(kind, kind === "alternate" ? label || "Alternate safe copy" : undefined)}
                className="group rounded-2xl border border-[#eadfca] bg-[#faf7f1] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#c6a15b] hover:shadow-md disabled:opacity-60"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#111b21] text-[#e7c87a] transition group-hover:scale-105">
                  <Icon className="size-4" />
                </span>
                <span className="mt-3 block text-sm font-semibold text-ink">{meta.title}</span>
                <span className="mt-1 block text-xs text-muted">{meta.blurb}</span>
              </button>
            );
          })}
        </div>

        <label className="text-sm">
          Alternate label
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Before Diwali campaign"
            className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3"
          />
        </label>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">7-day rolling lane</h4>
            <p className="text-xs text-muted">Oldest drops when a new daily copy lands</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {slots.map((slot) => (
              <div
                key={slot.key}
                className={`rounded-2xl border px-3 py-3 ${slot.backup ? "border-[#c6a15b] bg-[#faf6ee]" : "border-dashed border-line bg-[#fbfbfa]"}`}
              >
                <p className="text-[11px] font-medium text-muted">{slot.label}</p>
                <p className="mt-2 text-sm font-semibold">{slot.backup ? "Saved" : "Empty"}</p>
                {slot.backup ? <p className="mt-1 text-[11px] text-muted">{formatBytes(slot.backup.byteSize)}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <BackupList title="Alternate safe copies" rows={alternate} busy={busy} onDownload={onDownload} onRemove={onRemove} />
        <BackupList title="Instant backups" rows={instant} busy={busy} onDownload={onDownload} onRemove={onRemove} />
      </div>
    </article>
  );
}

function BackupList({
  title,
  rows,
  busy,
  onDownload,
  onRemove,
}: {
  title: string;
  rows: WorkspaceBackup[];
  busy: boolean;
  onDownload: (row: WorkspaceBackup) => void;
  onRemove: (row: WorkspaceBackup) => void;
}) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-muted">No copies yet.</p> : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.label || row.kind}</p>
                <p className="mt-1 text-xs text-muted">
                  {new Date(row.createdAt).toLocaleString("en-IN")} · {row.detail || formatBytes(row.byteSize)} · {row.status}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || row.status !== "ready"} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-3 text-sm disabled:opacity-50" onClick={() => onDownload(row)}>
                  <Download className="size-3.5" /> Download
                </button>
                <button type="button" disabled={busy} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-danger disabled:opacity-50" onClick={() => onRemove(row)}>
                  <Trash2 className="size-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function PremiumBackups({ workspaces }: Props) {
  const desks = useMemo(
    () => workspaces.filter((item) => item.workspaceType === "clinic" || item.workspaceType === "institute"),
    [workspaces],
  );
  const [backups, setBackups] = useState<WorkspaceBackup[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [activeDesk, setActiveDesk] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [progress, setProgress] = useState<BackupProgress | null>(null);

  const reload = () => {
    void listWorkspaceBackups()
      .then(setBackups)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load backups"));
  };

  useEffect(() => {
    reload();
  }, []);

  const run = async (workspace: WorkspaceOption, kind: BackupKind, label?: string) => {
    setError("");
    setNotice("");
    setBusyKey(`${workspace.id}:${kind}`);
    setActiveWorkspaceId(workspace.id);
    setActiveDesk(workspace.workspaceType === "institute" ? "Institute" : "Clinic");
    setProgress({ phase: "prepare", table: "", tableIndex: 0, tableTotal: 1, rows: 0, percent: 1, message: "Starting premium backup…" });
    try {
      await createWorkspaceBackup(workspace.id, kind, {
        label,
        onProgress: setProgress,
      });
      setNotice(`${workspace.name} ${KIND_META[kind].title.toLowerCase()} is ready.`);
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Backup failed");
    } finally {
      setBusyKey("");
      setActiveWorkspaceId("");
      window.setTimeout(() => setProgress((current) => (current?.phase === "done" || current?.phase === "error" ? null : current)), 1800);
    }
  };

  return (
    <div className="space-y-5">
      <style>{`
        @keyframes backupSheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
        @keyframes backupPulse { 0%, 100% { box-shadow: 0 24px 60px rgba(15,28,46,0.28); } 50% { box-shadow: 0 28px 70px rgba(198,161,91,0.28); } }
        @keyframes backupRunner { 0% { left: -20%; } 100% { left: 100%; } }
        .backup-sheen::before { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.12) 48%, transparent 66%); animation: backupSheen 2.8s linear infinite; }
        .backup-pulse { animation: backupPulse 2.2s ease-in-out infinite; }
        .backup-runner { position: absolute; top: 0; bottom: 0; width: 22%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent); animation: backupRunner 1.1s linear infinite; }
      `}</style>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-[#8a6a2f] uppercase">
            <Sparkles className="size-3.5" /> Premium backups
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Clinic & Institute vaults</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Separate full-data backups for each desk. Run an instant copy, keep a 7-day rolling lane, or freeze an alternate safe copy. Secrets are redacted from channel settings. On this PC, keep <span className="font-medium text-ink">scripts/start-local-backup-daemon.bat</span> running for automatic daytime rolling backups.
          </p>
        </div>
      </div>

      <ProgressTheatre progress={progress} desk={activeDesk || "Workspace"} />

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
      {notice ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {desks.map((workspace) => (
          <DeskBackupCard
            key={workspace.id}
            workspace={workspace}
            backups={backups.filter((row) => row.workspaceId === workspace.id)}
            busy={Boolean(busyKey)}
            active={activeWorkspaceId === workspace.id}
            onRun={(kind, label) => void run(workspace, kind, label)}
            onDownload={(row) => {
              void downloadWorkspaceBackup(row)
                .then(() => setNotice("Backup downloaded."))
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Download failed"));
            }}
            onRemove={(row) => {
              if (!window.confirm("Delete this backup from the vault?")) return;
              void removeWorkspaceBackup(row)
                .then(() => {
                  setNotice("Backup removed.");
                  reload();
                })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not delete backup"));
            }}
          />
        ))}
      </div>
      {desks.length === 0 ? <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">No clinic or institute workspace found.</p> : null}
    </div>
  );
}

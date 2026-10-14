export function elapsedSeconds(startedAt: string, endedAt: string) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 1000);
}

export function remainingSeconds(targetSeconds: number, actualSeconds: number) {
  return Math.max(targetSeconds - actualSeconds, 0);
}

export function sumCompleted(durations: Array<number | null | undefined>) {
  return durations.reduce<number>((total, value) => total + (typeof value === "number" && value >= 0 ? value : 0), 0);
}

export type CallOutcome = "connected" | "rejected" | "no_answer";

export interface CallTotals {
  dials: number;
  connected: number;
  rejected: number;
  noAnswer: number;
  talkSeconds: number;
}

export function emptyCallTotals(): CallTotals {
  return { dials: 0, connected: 0, rejected: 0, noAnswer: 0, talkSeconds: 0 };
}

export function summarizeCalls(rows: Array<{ status?: string | null; outcome?: string | null; duration_seconds?: number | null }>) {
  const totals = emptyCallTotals();
  for (const row of rows) {
    if (row.status && row.status !== "completed") continue;
    if (row.outcome !== "connected" && row.outcome !== "rejected" && row.outcome !== "no_answer") continue;
    totals.dials += 1;
    if (row.outcome === "connected") {
      totals.connected += 1;
      totals.talkSeconds += typeof row.duration_seconds === "number" && row.duration_seconds > 0 ? row.duration_seconds : 0;
    } else if (row.outcome === "rejected") {
      totals.rejected += 1;
    } else {
      totals.noAnswer += 1;
    }
  }
  return totals;
}

export function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

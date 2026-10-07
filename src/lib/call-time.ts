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

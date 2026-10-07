export function rangeForPreset(preset: "today" | "yesterday" | "month" | "year" | "all", now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  if (preset === "all") return { from: "1970-01-01", to: "2999-12-31" };
  if (preset === "today") return { from: iso(day), to: iso(day) };
  if (preset === "yesterday") {
    const previous = new Date(day);
    previous.setDate(previous.getDate() - 1);
    return { from: iso(previous), to: iso(previous) };
  }
  if (preset === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(day) };
  return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(day) };
}

export function automationDecision(input: { replied: boolean; tokenConfigured: boolean }) {
  if (input.replied) return "stopped";
  if (!input.tokenConfigured) return "configuration_required";
  return "send";
}

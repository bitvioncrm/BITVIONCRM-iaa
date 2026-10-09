export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "this_month" | "last_month" | "this_year" | "custom";

export const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range" },
];

function ymd(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function rangeBounds(key: RangeKey, customFrom = "", customTo = "", now = new Date()) {
  const endExclusive = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  let from = startOfDay(now);
  let to = endExclusive(now);
  if (key === "yesterday") {
    from = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
    to = startOfDay(now);
  } else if (key === "7d") {
    from = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 6);
  } else if (key === "30d") {
    from = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 29);
  } else if (key === "this_month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (key === "last_month") {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (key === "this_year") {
    from = new Date(now.getFullYear(), 0, 1);
  } else if (key === "custom") {
    if (customFrom) from = startOfDay(new Date(`${customFrom}T00:00:00`));
    if (customTo) to = endExclusive(new Date(`${customTo}T00:00:00`));
    if (to <= from) to = endExclusive(from);
  }
  const inclusiveEnd = new Date(to.getTime() - 1);
  const preset = RANGE_OPTIONS.find((item) => item.key === key)?.label ?? "Last 30 days";
  const label = key === "custom" ? `${ymd(from)} – ${ymd(inclusiveEnd)}` : preset;
  return { from: from.toISOString(), to: to.toISOString(), fromDate: ymd(from), toDate: ymd(inclusiveEnd), label };
}

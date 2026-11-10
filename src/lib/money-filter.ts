import { rangeBounds, type RangeKey } from "@/lib/range";

export type MoneyPeriod = "today" | "yesterday" | "week" | "month" | "year" | "custom";

export const MONEY_PERIODS: Array<{ key: MoneyPeriod; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
];

export function moneyPeriodToRangeKey(period: MoneyPeriod): RangeKey {
  if (period === "yesterday") return "yesterday";
  if (period === "week") return "this_week";
  if (period === "month") return "this_month";
  if (period === "year") return "this_year";
  if (period === "custom") return "custom";
  return "today";
}

export function rangeKeyToMoneyPeriod(key: RangeKey): MoneyPeriod {
  if (key === "yesterday") return "yesterday";
  if (key === "this_week" || key === "7d") return "week";
  if (key === "this_month" || key === "30d" || key === "last_month") return "month";
  if (key === "this_year") return "year";
  if (key === "custom") return "custom";
  return "today";
}

export function moneyPeriodBounds(period: MoneyPeriod, customFrom = "", customTo = "", now = new Date()) {
  return rangeBounds(moneyPeriodToRangeKey(period), customFrom, customTo, now);
}

export function stampInMoneyPeriod(iso: string | null | undefined, period: MoneyPeriod, customFrom = "", customTo = "") {
  if (!iso) return false;
  const bounds = moneyPeriodBounds(period, customFrom, customTo);
  const time = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();
  if (Number.isNaN(time)) return false;
  return time >= new Date(bounds.from).getTime() && time < new Date(bounds.to).getTime();
}

import {
  addDays,
  eachDayOfInterval,
  endOfDay,
  format,
  formatDistanceToNow,
  isSameDay,
  startOfDay,
  subDays,
} from "date-fns";
import type { DateRangeKey } from "@/types";

export function rangeBounds(key: DateRangeKey, now = new Date()) {
  const end = endOfDay(now);
  if (key === "today") return { start: startOfDay(now), end };
  if (key === "week") return { start: startOfDay(subDays(now, 6)), end };
  return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), end };
}

export function inRange(iso: string | null | undefined, key: DateRangeKey, now = new Date()) {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  const { start, end } = rangeBounds(key, now);
  return time >= start.getTime() && time <= end.getTime();
}

export function formatDate(iso: string | null | undefined, pattern = "d MMM yyyy") {
  if (!iso) return "—";
  return format(new Date(iso), pattern);
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return format(new Date(iso), "d MMM yyyy, h:mm a");
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return format(new Date(iso), "h:mm a");
}

export function formatSmart(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "—";
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < 36 * 60 * 60 * 1000) {
    return formatDistanceToNow(date, { addSuffix: true });
  }
  return format(date, "d MMM yyyy");
}

/** Lead arrival time for lists and alerts — clock time when it came in. */
export function formatLeadArrived(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "—";
  const date = new Date(iso);
  const clock = format(date, "h:mm a");
  if (isSameDay(date, now)) return `Today, ${clock}`;
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < 36 * 60 * 60 * 1000) {
    return `${formatDistanceToNow(date, { addSuffix: true })} · ${clock}`;
  }
  return format(date, "d MMM yyyy, h:mm a");
}

export function toDateTimeLocal(isoOrDate: string | Date = new Date()) {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function tomorrowAt10(now = new Date()) {
  const date = addDays(startOfDay(now), 1);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
}

export function atHour(dayOffset: number, hour: number, minute = 0, now = new Date()) {
  const date = addDays(startOfDay(now), dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export function followUpBucket(dueAt: string, status: "pending" | "completed", now = new Date()) {
  if (status === "completed") return "completed" as const;
  const due = new Date(dueAt);
  const start = startOfDay(now);
  const end = endOfDay(now);
  if (due < start) return "overdue" as const;
  if (due <= end) return "today" as const;
  return "upcoming" as const;
}

export function dayLabels(key: DateRangeKey, now = new Date()) {
  if (key === "today") {
    return Array.from({ length: 12 }, (_, index) => {
      const hour = index + 8;
      return { label: `${hour}:00`, date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour) };
    });
  }
  if (key === "week") {
    const { start } = rangeBounds("week", now);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return { label: format(date, "EEE"), date };
    });
  }
  const { start, end } = rangeBounds("month", now);
  return eachDayOfInterval({ start, end }).map((date) => ({
    label: format(date, "d"),
    date,
  }));
}

export function sameSlot(iso: string, slot: Date, key: DateRangeKey) {
  const date = new Date(iso);
  if (key === "today") return isSameDay(date, slot) && date.getHours() === slot.getHours();
  return isSameDay(date, slot);
}

export function monthKey(iso: string) {
  return format(new Date(iso), "MMM yy");
}

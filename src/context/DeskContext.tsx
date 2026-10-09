import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { rangeBounds, type RangeKey } from "@/lib/range";

export type DeskKey = "all" | "clinic" | "institute";

interface DeskValue {
  desk: DeskKey;
  setDesk: (desk: DeskKey) => void;
  rangeKey: RangeKey;
  setRangeKey: (key: RangeKey) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  bounds: ReturnType<typeof rangeBounds>;
}

const DeskContext = createContext<DeskValue | null>(null);

export function DeskProvider({ children }: { children: ReactNode }) {
  const [desk, setDesk] = useState<DeskKey>("all");
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const bounds = useMemo(() => rangeBounds(rangeKey, customFrom, customTo), [customFrom, customTo, rangeKey]);
  const value = useMemo(
    () => ({ desk, setDesk, rangeKey, setRangeKey, customFrom, setCustomFrom, customTo, setCustomTo, bounds }),
    [bounds, customFrom, customTo, desk, rangeKey],
  );
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk() {
  const value = useContext(DeskContext);
  if (!value) throw new Error("Desk filters are unavailable");
  return value;
}

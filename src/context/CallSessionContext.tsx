import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CallResultButtons } from "@/components/calls/CallResultButtons";
import { useDialEndedAt } from "@/components/calls/useDialEndedAt";
import { useAuth } from "@/context/AuthContext";
import { formatClock, outcomeFromPhoneReturn, type CallOutcome } from "@/lib/call-time";
import { activeCall, endCall, startCall, type LiveCall } from "@/services/production-ops";

interface SavedCall {
  name: string;
  seconds: number;
  outcome: CallOutcome;
}

interface CallSessionValue {
  live: LiveCall | null;
  busy: boolean;
  elapsed: number;
  start: (input: { organizationId: string; workspaceId: string; leadId?: string | null; name: string }) => Promise<void>;
  finish: (outcome: CallOutcome) => void;
}

const CallSessionContext = createContext<CallSessionValue | null>(null);

export function CallSessionProvider({ children }: { children: ReactNode }) {
  const { productionUser } = useAuth();
  const [live, setLive] = useState<LiveCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [saved, setSaved] = useState<SavedCall | null>(null);
  const savedDial = useRef("");
  const returnedAt = useDialEndedAt(live?.id ?? "");
  const elapsed = live && now ? Math.max(0, Math.floor((now - new Date(live.startedAt).getTime()) / 1000)) : 0;

  useEffect(() => {
    if (!productionUser) return;
    void activeCall().then((row) => {
      setLive(row);
      if (!row) return;
      setNow(Date.now());
      const away = sessionStorage.getItem("bitvion-call-away");
      if (away === row.id && document.visibilityState === "visible") {
        sessionStorage.removeItem("bitvion-call-away");
        const seconds = Math.max(0, Math.floor((Date.now() - new Date(row.startedAt).getTime()) / 1000));
        if (seconds >= 2) {
          savedDial.current = row.id;
          void endCall(row.id, outcomeFromPhoneReturn(seconds)).then((duration) => {
            setLive(null);
            setSaved({ name: row.name || "Call", seconds: duration, outcome: outcomeFromPhoneReturn(seconds) });
            window.dispatchEvent(new CustomEvent("bitvion-call-saved"));
          }).catch(() => {
            savedDial.current = "";
          });
        }
      }
    }).catch(() => setLive(null));
  }, [productionUser]);

  useEffect(() => {
    if (!live) return;
    const sync = () => setNow(Date.now());
    sync();
    const timer = window.setInterval(sync, 1000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [live]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(null), 5000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const finish = (outcome: CallOutcome, endedAt?: string) => {
    if (!live || savedDial.current === live.id) return;
    savedDial.current = live.id;
    sessionStorage.removeItem("bitvion-call-away");
    const name = live.name || "Call";
    setBusy(true);
    void endCall(live.id, outcome, endedAt)
      .then((duration) => {
        setLive(null);
        setSaved({ name, seconds: duration, outcome });
        window.dispatchEvent(new CustomEvent("bitvion-call-saved"));
        return duration;
      })
      .catch(() => {
        savedDial.current = "";
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (!live || !returnedAt) return;
    const seconds = Math.max(0, Math.floor((new Date(returnedAt).getTime() - new Date(live.startedAt).getTime()) / 1000));
    finish(outcomeFromPhoneReturn(seconds), returnedAt);
  }, [live, returnedAt]);

  const start: CallSessionValue["start"] = async (input) => {
    setBusy(true);
    try {
      const row = await startCall(input.organizationId, input.workspaceId, input.leadId ?? null, input.name);
      setLive({ ...row, name: input.name || row.name });
      setSaved(null);
      savedDial.current = "";
    } finally {
      setBusy(false);
    }
  };

  return (
    <CallSessionContext.Provider value={{ live, busy, elapsed, start, finish }}>
      {children}
      {live ? (
        <div className="fixed inset-x-3 bottom-20 z-30 rounded-2xl border border-[#c6a15b] bg-[#0e1420] p-3 text-white shadow-lg lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[360px]">
          <p className="text-xs font-medium tracking-wide text-[#e8d5a3] uppercase">On a call · time runs automatically</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="min-w-0 truncate text-sm">{live.name || "Call"}</p>
            <p className="text-3xl font-semibold tabular">{formatClock(elapsed)}</p>
          </div>
          <div className="mt-3">
            <CallResultButtons busy={busy} onResult={finish} />
          </div>
        </div>
      ) : saved ? (
        <div className="fixed inset-x-3 bottom-20 z-30 rounded-2xl border border-[#eadfca] bg-white p-3 shadow-lg lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[360px]">
          <p className="text-xs font-medium tracking-wide text-[#8a6a2f] uppercase">Call time saved</p>
          <p className="mt-1 text-sm">{saved.name} · {saved.outcome === "connected" ? "Connected" : saved.outcome === "rejected" ? "Rejected" : "No answer"} · {formatClock(saved.seconds)}</p>
        </div>
      ) : null}
    </CallSessionContext.Provider>
  );
}

export function useCallSession() {
  const value = useContext(CallSessionContext);
  if (!value) throw new Error("Call timing is unavailable");
  return value;
}

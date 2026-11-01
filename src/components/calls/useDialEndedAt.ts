import { useEffect, useState } from "react";

const AWAY_MS = 1500;

export function useDialEndedAt(sessionId: string) {
  const [endedAt, setEndedAt] = useState<string | null>(null);

  useEffect(() => {
    setEndedAt(null);
    if (!sessionId) return;
    let hiddenAt = 0;
    const markHidden = () => {
      hiddenAt = Date.now();
      sessionStorage.setItem("bitvion-call-away", sessionId);
    };
    const markBack = () => {
      if (!hiddenAt) return;
      const away = Date.now() - hiddenAt;
      hiddenAt = 0;
      if (away < AWAY_MS) return;
      setEndedAt((current) => current ?? new Date().toISOString());
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") markHidden();
      else markBack();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", markHidden);
    window.addEventListener("pageshow", markBack);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", markHidden);
      window.removeEventListener("pageshow", markBack);
    };
  }, [sessionId]);

  return endedAt;
}

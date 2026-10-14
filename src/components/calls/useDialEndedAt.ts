import { useEffect, useState } from "react";

export function useDialEndedAt(active: boolean) {
  const [endedAt, setEndedAt] = useState<string | null>(null);

  useEffect(() => {
    setEndedAt(null);
    if (!active) return;
    let left = false;
    const onChange = () => {
      if (document.visibilityState === "hidden") left = true;
      if ((document.visibilityState === "visible" || document.hasFocus()) && left) {
        setEndedAt((current) => current ?? new Date().toISOString());
      }
    };
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [active]);

  return endedAt;
}

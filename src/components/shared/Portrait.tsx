import { useEffect, useState } from "react";
import { signedDocumentUrl } from "@/services/production-ops";
import { cn } from "@/lib/utils";

const portraitUrls = new Map<string, string>();
const portraitPending = new Map<string, Promise<string>>();

function portraitUrl(path: string) {
  const saved = portraitUrls.get(path);
  if (saved) return Promise.resolve(saved);
  const pending = portraitPending.get(path);
  if (pending) return pending;
  const request = signedDocumentUrl(path).then((url) => {
    portraitUrls.set(path, url);
    portraitPending.delete(path);
    return url;
  }).catch((error: unknown) => {
    portraitPending.delete(path);
    throw error;
  });
  portraitPending.set(path, request);
  return request;
}

export function Portrait({ name, path, className }: { name: string; path?: string; className?: string }) {
  const [url, setUrl] = useState(() => (path ? portraitUrls.get(path) ?? "" : ""));
  useEffect(() => {
    if (!path) {
      setUrl("");
      return;
    }
    const saved = portraitUrls.get(path);
    if (saved) {
      setUrl(saved);
      return;
    }
    let active = true;
    void portraitUrl(path).then((next) => { if (active) setUrl(next); }).catch(() => { if (active) setUrl(""); });
    return () => { active = false; };
  }, [path]);
  const letter = name.trim().charAt(0).toUpperCase() || "•";
  if (url) return <img src={url} alt="" className={cn("rounded-full object-cover", className ?? "size-11")} />;
  return <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-[#0e1420] font-semibold text-[#e8d5a3]", className ?? "size-11 text-sm")}>{letter}</span>;
}

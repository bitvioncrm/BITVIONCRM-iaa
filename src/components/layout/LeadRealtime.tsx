import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/** Keeps one live channel open for every signed-in screen so Meta and WhatsApp leads paint instantly. */
export function LeadRealtime() {
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    const channel = client
      .channel("lead-arrivals-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, (payload) => {
        const row = payload.new as Record<string, string | null | undefined>;
        if (!row.id || row.deleted_at) return;
        const fullName = row.full_name || "New lead";
        const body =
          row.source === "whatsapp_click"
            ? "WhatsApp click"
            : row.source_platform === "meta" || row.source === "meta_ads"
              ? "Meta form"
              : "New lead";
        window.dispatchEvent(new CustomEvent("bitvion-lead", { detail: { id: row.id, fullName, row, body } }));
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(body, { body: fullName });
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads" }, (payload) => {
        const row = payload.new as Record<string, string | null | undefined>;
        if (!row.id) return;
        window.dispatchEvent(new CustomEvent("bitvion-lead-update", { detail: { id: row.id, row } }));
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, []);

  return null;
}

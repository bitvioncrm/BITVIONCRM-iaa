import { useEffect } from "react";
import { toast } from "sonner";
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
        if (row.status === "excel" || row.source_platform === "excel" || (row.source === "whatsapp" && !row.source_platform)) return;
        const fullName = row.full_name || "New lead";
        const body =
          row.source === "whatsapp_click"
            ? "WhatsApp click"
            : row.source_platform === "meta" || row.source === "meta_ads"
              ? "Meta form"
              : "New lead";
        const campaign = String(row.source_campaign || "").trim();
        window.dispatchEvent(new CustomEvent("bitvion-lead", { detail: { id: row.id, fullName, row, body } }));
        toast.success(`${body}: ${fullName}`, {
          description: campaign || "Open Leads to call now",
          duration: 10000,
          action: {
            label: "Open",
            onClick: () => {
              window.location.assign(`/leads/${row.id}`);
            },
          },
        });
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const note = new Notification(body, { body: campaign ? `${fullName} · ${campaign}` : fullName, tag: String(row.id) });
          note.onclick = () => {
            window.focus();
            window.location.assign(`/leads/${row.id}`);
          };
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

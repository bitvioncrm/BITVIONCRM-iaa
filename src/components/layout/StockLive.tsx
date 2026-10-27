import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const CLINICAL = new Set(["super_admin", "admin", "doctor", "duty_doctor", "receptionist"]);

/** Live stock and treatment notices for the people who use the clinic store. */
export function StockLive({ roleKey }: { roleKey: string }) {
  useEffect(() => {
    const client = supabase;
    if (!client || !CLINICAL.has(roleKey)) return;
    const channel = client
      .channel("clinic-stock-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "inventory_products" }, (payload) => {
        const row = payload.new as { name?: string; current_stock?: number; deleted_at?: string | null };
        if (row.deleted_at) return;
        window.dispatchEvent(new CustomEvent("bitvion-stock"));
        toast.message(`${row.name || "A product"} now has ${Number(row.current_stock ?? 0)} in stock`, { duration: 6000 });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "patient_procedures" }, () => {
        window.dispatchEvent(new CustomEvent("bitvion-care"));
        toast.success("A treatment was saved", { description: "Products and the patient record are up to date.", duration: 6000 });
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [roleKey]);
  return null;
}

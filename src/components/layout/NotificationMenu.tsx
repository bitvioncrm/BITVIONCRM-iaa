import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { formatLeadArrived, formatSmart } from "@/lib/dates";
import { loadLiveAlerts } from "@/services/overview";
import { listWorkspaces } from "@/services/production-leads";

export function NotificationMenu() {
  const { productionUser } = useAuth();
  if (productionUser) return <LiveAlerts />;
  return <DemoAlerts />;
}

function LiveAlerts() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<{ title: string; body: string; href: string; at?: string }>>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listWorkspaces()
        .then((rows) => loadLiveAlerts(rows))
        .then((rows) => {
          if (active) setItems(rows);
        })
        .catch(() => {
          if (active) setItems([]);
        });
    };
    refresh();
    const onLead = (event: Event) => {
      const detail = (event as CustomEvent<{ fullName?: string; id?: string; body?: string; row?: Record<string, string | null> }>).detail;
      if (detail?.id && detail.fullName) {
        const at = formatLeadArrived(String(detail.row?.created_at || new Date().toISOString()));
        setItems((current) => [{ title: detail.fullName!, body: `${detail.body || "New lead"} · ${at}`, href: `/leads/${detail.id}`, at }, ...current].slice(0, 20));
      }
      refresh();
    };
    window.addEventListener("bitvion-lead", onLead);
    window.addEventListener("bitvion-lead-update", onLead);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 10000);
    return () => {
      active = false;
      window.removeEventListener("bitvion-lead", onLead);
      window.removeEventListener("bitvion-lead-update", onLead);
      window.clearInterval(timer);
    };
  }, []);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="relative rounded-md p-2 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Notifications">
          <Bell className="size-4" />
          {items.length ? <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white">{items.length}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <div className="border-b border-line px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted">No operational alerts.</p> : items.map((item) => (
            <button key={`${item.href}:${item.body}:${item.title}`} type="button" className="block w-full border-b border-line px-3 py-3 text-left last:border-0 hover:bg-slate-50" onClick={() => navigate(item.href)}>
              <span className="block text-[13px] font-medium">{item.title}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{item.body}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DemoAlerts() {
  const navigate = useNavigate();
  const { state, markNotification, markAllRead } = useCrm();
  const unread = state.notifications.filter((item) => !item.read).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="relative rounded-md p-2 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Notifications">
          <Bell className="size-4" />
          {unread ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-navy px-1 text-[10px] text-white">
              {unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          <button type="button" className="text-xs text-muted hover:text-ink" onClick={markAllRead}>
            Mark all read
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {state.notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">You are caught up.</p>
          ) : (
            state.notifications.slice(0, 12).map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full gap-3 border-b border-line px-3 py-3 text-left last:border-0 hover:bg-slate-50"
                onClick={() => {
                  markNotification(item.id);
                  navigate(item.href);
                }}
              >
                <span className={`mt-1 size-1.5 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-info"}`} />
                <span>
                  <span className="block text-[13px] font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{item.body}</span>
                  <span className="mt-1 block text-[11px] text-slate-400">{formatSmart(item.createdAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

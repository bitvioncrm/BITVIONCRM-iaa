import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { formatSmart } from "@/lib/dates";
import { loadLiveAlerts } from "@/services/overview";
import { listWorkspaces } from "@/services/production-leads";

export function NotificationMenu() {
  const { productionUser } = useAuth();
  if (productionUser) return <LiveAlerts />;
  return <DemoAlerts />;
}

function LiveAlerts() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<{ title: string; body: string; href: string }>>([]);
  useEffect(() => {
    void listWorkspaces().then((rows) => loadLiveAlerts(rows)).then(setItems).catch(() => setItems([]));
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
          <p className="text-[11px] text-muted">Live alerts from current records. They are not a second copy of each event.</p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted">No operational alerts.</p> : items.map((item) => (
            <button key={item.title} type="button" className="block w-full border-b border-line px-3 py-3 text-left last:border-0 hover:bg-slate-50" onClick={() => navigate(item.href)}>
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

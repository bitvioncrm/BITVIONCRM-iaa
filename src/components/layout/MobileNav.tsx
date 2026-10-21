import { Menu } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { NAV_ITEMS, productionNav, STAFF_NAV, type NavItem } from "@/components/layout/nav";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { isAdmin } from "@/lib/scope";
import { cn } from "@/lib/utils";

const SHORT_LABEL: Record<string, string> = {
  "/": "Home",
  "/desk": "Desk",
  "/leads": "Leads",
  "/pipeline": "Pipeline",
  "/follow-ups": "Follow-ups",
  "/calls": "Calls",
  "/whatsapp": "WhatsApp",
  "/campaigns": "Campaigns",
  "/templates": "Templates",
  "/tasks": "Tasks",
  "/reports": "Reports",
  "/team": "Team",
  "/activity": "Activity",
  "/settings": "Settings",
  "/clinic": "Clinic",
  "/institute": "Institute",
  "/inventory": "Stock",
  "/billing": "Finance",
};

const BOTTOM_FIRST = ["/", "/leads", "/whatsapp", "/calls"];

function shortLabel(item: NavItem) {
  return SHORT_LABEL[item.to] ?? item.label;
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { session, productionUser } = useAuth();
  const { state } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const admin = productionUser ? false : isAdmin(me);
  const links = productionUser ? productionNav(productionUser.roleKey) : admin ? [...NAV_ITEMS] : [...STAFF_NAV];
  const preferred = BOTTOM_FIRST.map((path) => links.find((item) => item.to === path)).filter((item): item is NavItem => Boolean(item));
  const bottom = (preferred.length ? preferred : links).slice(0, 4);
  const bottomPaths = new Set(bottom.map((item) => item.to));
  const more = links.filter((item) => !bottomPaths.has(item.to));
  const showMore = more.length > 0;
  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${bottom.length + (showMore ? 1 : 0)}, minmax(0, 1fr))` }}
      >
        {bottom.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn("flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px]", isActive ? "text-navy" : "text-muted")}
          >
            <item.icon className="size-5" />
            <span className="max-w-full truncate">{shortLabel(item)}</span>
          </NavLink>
        ))}
        {showMore ? (
          <button type="button" className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] text-muted" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
            More
          </button>
        ) : null}
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="All sections" className="max-w-xs">
          <div className="border-b border-line px-4 py-4 text-sm font-semibold">All sections</div>
          <div className="max-h-[calc(100dvh-4rem)] space-y-1 overflow-y-auto p-3 pb-8">
            {more.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50">
                <item.icon className="size-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

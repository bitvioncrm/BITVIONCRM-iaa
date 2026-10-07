import { Menu } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { MOBILE_NAV, NAV_ITEMS, productionNav, STAFF_NAV } from "@/components/layout/nav";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { isAdmin } from "@/lib/scope";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { session, productionUser } = useAuth();
  const { state } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const admin = productionUser ? false : isAdmin(me);
  const links = productionUser ? productionNav(productionUser.roleKey) : admin ? NAV_ITEMS : STAFF_NAV;
  const bottom = productionUser ? links.slice(0, 4) : admin ? MOBILE_NAV : STAFF_NAV;
  const more = productionUser ? links.slice(4) : admin ? NAV_ITEMS.filter((item) => !MOBILE_NAV.some((link) => link.to === item.to)) : [];
  const showMore = more.length > 0;
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-white lg:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length + (showMore ? 1 : 0)}, minmax(0, 1fr))` }}>
        {bottom.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn("flex flex-col items-center gap-1 py-2 text-[10px]", isActive ? "text-navy" : "text-muted")}
          >
            <item.icon className="size-4" />
            {item.label === "Dashboard" ? "Home" : item.label}
          </NavLink>
        ))}
        {showMore ? (
          <button type="button" className="flex flex-col items-center gap-1 py-2 text-[10px] text-muted" onClick={() => setOpen(true)}>
            <Menu className="size-4" />
            More
          </button>
        ) : null}
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="More" className="max-w-xs">
          <div className="border-b border-line px-4 py-4 text-sm font-semibold">More</div>
          <div className="space-y-1 p-3">
            {more.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50">
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

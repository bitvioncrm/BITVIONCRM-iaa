import { useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown, LogOut } from "lucide-react";
import { NAV_ITEMS, productionGroups, STAFF_NAV } from "@/components/layout/nav";
import { productionRoleLabel } from "@/lib/production-access";
import { Logo } from "@/components/shared/Logo";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { ROLE_LABEL } from "@/data/catalog";
import { isAdmin } from "@/lib/scope";
import { cn } from "@/lib/utils";

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { session, logout, productionUser } = useAuth();
  const { state } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const admin = productionUser ? productionUser.roleKey === "super_admin" || productionUser.roleKey === "admin" : isAdmin(me);
  const groups = productionUser ? productionGroups(productionUser.roleKey) : null;
  const items = groups ? groups.flatMap((group) => group.items) : admin ? NAV_ITEMS : STAFF_NAV;
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const deskLabel = productionUser
    ? productionRoleLabel(productionUser.roleKey)
    : me?.businessUnit === "clinic"
      ? "Clinic · Perumbavoor"
      : me?.businessUnit === "institute"
        ? "Institute · Kochi"
        : ROLE_LABEL[session?.role ?? "administrator"];

  return (
    <aside className={cn("hidden h-full shrink-0 flex-col bg-sidebar text-slate-300 lg:flex", collapsed ? "w-[72px]" : "w-[248px]")}>
      <div className={cn("flex items-center border-b border-white/10", collapsed ? "h-16 justify-center px-2" : "h-[76px] px-4")}>
        <Logo mark={collapsed} className={collapsed ? "h-8 w-8" : "h-11 w-auto max-w-[168px]"} />
      </div>
      <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-3">
        {groups && !collapsed
          ? groups.map((group) => {
              const hidden = closed[group.label];
              return (
                <div key={group.label}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-2.5 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase"
                    onClick={() => setClosed((current) => ({ ...current, [group.label]: !current[group.label] }))}
                    aria-expanded={!hidden}
                  >
                    {group.label}
                    <ChevronDown className={cn("size-3 transition", hidden && "-rotate-90")} />
                  </button>
                  {hidden ? null : group.items.map((item) => <SideLink key={item.to} item={item} collapsed={false} />)}
                </div>
              );
            })
          : items.map((item) => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
      </nav>
      <div className={cn("flex items-center gap-2 border-t border-white/10 p-3", collapsed && "flex-col")}>
        <Avatar name={session?.name ?? "Akhil Shijo"} />
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white">{session?.name ?? "Akhil Shijo"}</p>
            <p className="truncate text-[11px] text-slate-400">{deskLabel}</p>
          </div>
        )}
        <button type="button" onClick={logout} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Sign out">
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  );
}

function SideLink({ item, collapsed }: { item: { to: string; label: string; end: boolean; icon: typeof NAV_ITEMS[number]["icon"] }; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={item.label}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium text-slate-300 hover:bg-white/5 hover:text-white",
          collapsed && "justify-center px-0",
          isActive && "bg-white/10 text-white shadow-[inset_2px_0_0_#60a5fa]",
        )
      }
    >
      <item.icon className="size-4 shrink-0" />
      {collapsed ? null : item.label}
    </NavLink>
  );
}

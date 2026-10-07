import { Menu, PanelLeft, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { NAV_ITEMS, productionNav, STAFF_NAV } from "@/components/layout/nav";
import { NotificationMenu } from "@/components/layout/NotificationMenu";
import { Logo } from "@/components/shared/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { isAdmin } from "@/lib/scope";
import { ROLE_LABEL } from "@/data/catalog";

export function TopBar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { session, previewRole, productionUser } = useAuth();
  const { state } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const items = productionUser ? productionNav(productionUser.roleKey) : isAdmin(me) ? NAV_ITEMS : STAFF_NAV;

  return (
    <header className="flex h-14 items-center gap-2 border-b border-line bg-white px-3 sm:px-4">
      <button type="button" aria-pressed={collapsed} className="hidden rounded-md p-2 text-muted hover:bg-slate-100 lg:inline-flex" onClick={onToggle} aria-label="Collapse sidebar">
        <PanelLeft className="size-4" />
      </button>
      <button type="button" className="rounded-md p-2 text-muted hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
        <Menu className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-canvas px-3 text-left text-sm text-muted sm:max-w-md"
      >
        <Search className="size-4" />
        <span className="truncate">Search leads, phone, place</span>
        <kbd className="ml-auto hidden rounded border border-line bg-white px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline">Ctrl K</kbd>
      </button>
      {productionUser ? null : <span className="hidden rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 md:inline">Demo Mode</span>}
      <ThemeToggle />
      {!productionUser && previewRole !== "administrator" ? (
        <span className="hidden text-xs text-muted xl:inline">Previewing as {ROLE_LABEL[previewRole]}</span>
      ) : null}
      <NotificationMenu />
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <Hotkey onOpen={() => setSearchOpen(true)} />
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent title="Menu" className="max-w-xs bg-sidebar text-slate-200">
          <div className="border-b border-white/10 px-4 py-4">
            <Logo className="h-12 w-auto max-w-[180px]" />
          </div>
          <nav className="space-y-1 p-3">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `flex items-center gap-2 rounded-md px-2 py-2 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-300"}`}
              >
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
      </header>
  );
}

function Hotkey({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
  return null;
}

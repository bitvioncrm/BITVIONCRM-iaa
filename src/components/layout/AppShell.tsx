import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ADMIN_ONLY_PREFIXES } from "@/components/layout/nav";
import { roleAllowsPath } from "@/lib/production-access";
import { LeadRealtime } from "@/components/layout/LeadRealtime";
import { StockLive } from "@/components/layout/StockLive";
import { MobileNav } from "@/components/layout/MobileNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useAuth } from "@/context/AuthContext";
import { DeskProvider } from "@/context/DeskContext";
import { useCrm } from "@/context/CrmContext";
import { ROLE_LABEL } from "@/data/catalog";
import { isAdmin } from "@/lib/scope";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const { session, previewRole, setPreviewRole, productionUser } = useAuth();
  const { state } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const admin = productionUser ? productionUser.roleKey === "super_admin" || productionUser.roleKey === "admin" : isAdmin(me);
  const blocked = productionUser ? !roleAllowsPath(productionUser.roleKey, pathname) : !admin && ADMIN_ONLY_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return (
    <DeskProvider>
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      {productionUser ? <LeadRealtime /> : null}
      {productionUser ? <StockLive roleKey={productionUser.roleKey} /> : null}
      <Sidebar collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        {admin && !productionUser && previewRole !== "administrator" ? (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
            <span>Previewing as {ROLE_LABEL[previewRole]}.</span>
            <button type="button" className="font-medium underline" onClick={() => setPreviewRole("administrator")}>
              Return to Administrator
            </button>
          </div>
        ) : null}
        <main className="flex-1 overflow-y-auto pb-24 lg:pb-0">
          <div key={pathname} className="page-enter mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
            {blocked ? <Navigate to="/" replace /> : <Outlet />}
          </div>
        </main>
      </div>
      <MobileNav />
    </div>
    </DeskProvider>
  );
}

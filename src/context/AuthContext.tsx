import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ROLE_LABEL } from "@/data/catalog";
import { setAuthRemember, supabase, supabaseConfigured } from "@/lib/supabase";
import { primaryRoleKey } from "@/services/production-leads";
import type { Role } from "@/types";

interface Session {
  email: string;
  userId: string;
  name: string;
  role: Role;
}

export interface ProductionUser {
  userId: string;
  email: string;
  roleKey: string;
}

interface AuthValue {
  ready: boolean;
  session: Session | null;
  productionUser: ProductionUser | null;
  previewRole: Role;
  roleLabel: string;
  signup: (email: string, password: string) => Promise<string | null>;
  login: (email: string, password: string, remember?: boolean) => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  logout: () => void;
  setPreviewRole: (role: Role) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function appRole(key: string): Role {
  if (key === "super_admin" || key === "admin") return "administrator";
  return "counsellor";
}

async function hydrateUser(user: { id: string; email?: string | null }) {
  if (!user.email) return null;
  const key = await primaryRoleKey().catch(() => "");
  let name = user.email;
  if (supabase) {
    const profile = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const fullName = String(profile.data?.full_name || "").trim();
    if (fullName) name = fullName;
  }
  return {
    session: { email: user.email, userId: user.id, name, role: appRole(key) } satisfies Session,
    productionUser: { userId: user.id, email: user.email, roleKey: key } satisfies ProductionUser,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [productionUser, setProductionUser] = useState<ProductionUser | null>(null);
  const [previewRole, setPreviewRole] = useState<Role>("administrator");

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }

    let active = true;
    const apply = async (user: { id: string; email?: string | null } | null | undefined) => {
      if (!active) return;
      if (!user?.email) {
        setProductionUser(null);
        setSession(null);
        return;
      }
      const next = await hydrateUser(user);
      if (!active || !next) return;
      setProductionUser(next.productionUser);
      setSession(next.session);
      setPreviewRole(next.session.role);
    };

    void supabase.auth.getSession().then(({ data }) => apply(data.session?.user)).finally(() => {
      if (active) setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void apply(nextSession?.user);
    });

    // Refresh proactively during a long local admin day.
    const timer = window.setInterval(() => {
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session) void supabase.auth.refreshSession();
      });
    }, 45 * 60 * 1000);

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      session,
      productionUser,
      previewRole,
      roleLabel: ROLE_LABEL[previewRole],
      signup: async (email, password) => {
        if (!supabase) return "Configuration Required. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
        const { error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password });
        return error ? error.message : null;
      },
      login: async (email, password, remember = true) => {
        if (!supabase) return "Configuration Required. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
        setAuthRemember(remember);
        const trimmed = email.trim().toLowerCase();
        const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
        if (error || !data.user?.email) return error?.message ?? "Invalid email or password.";
        const next = await hydrateUser(data.user);
        if (!next) return "Invalid email or password.";
        setProductionUser(next.productionUser);
        setSession(next.session);
        setPreviewRole(next.session.role);
        return null;
      },
      resetPassword: async (email) => {
        if (!supabase) return "Configuration Required. Password reset needs Supabase Auth.";
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
        return error ? error.message : null;
      },
      logout: () => {
        setProductionUser(null);
        setSession(null);
        void supabase?.auth.signOut();
      },
      setPreviewRole,
    }),
    [previewRole, productionUser, ready, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export { supabaseConfigured };

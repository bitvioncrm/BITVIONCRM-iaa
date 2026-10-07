import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ROLE_LABEL } from "@/data/catalog";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { primaryRoleKey } from "@/services/production-leads";
import type { Role } from "@/types";

const SESSION_KEY = "recruitflow.session";

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
  session: Session | null;
  productionUser: ProductionUser | null;
  previewRole: Role;
  roleLabel: string;
  signup: (email: string, password: string) => Promise<string | null>;
  login: (email: string, password: string) => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  logout: () => void;
  setPreviewRole: (role: Role) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function appRole(key: string): Role {
  if (key === "super_admin" || key === "admin") return "administrator";
  return "counsellor";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [productionUser, setProductionUser] = useState<ProductionUser | null>(null);
  const [previewRole, setPreviewRole] = useState<Role>("administrator");

  useEffect(() => {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    if (!supabase) return;
    void supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user?.email) return;
      const key = await primaryRoleKey().catch(() => "");
      const next = { email: user.email, userId: user.id, name: user.email, role: appRole(key) };
      setProductionUser({ userId: user.id, email: user.email, roleKey: key });
      setSession(next);
      setPreviewRole(next.role);
    });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      productionUser,
      previewRole,
      roleLabel: ROLE_LABEL[previewRole],
      signup: async (email, password) => {
        if (!supabase) return "Configuration Required. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
        const { error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password });
        return error ? error.message : null;
      },
      login: async (email, password) => {
        if (!supabase) return "Configuration Required. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
        const trimmed = email.trim().toLowerCase();
        const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
        if (error || !data.user?.email) return error?.message ?? "Invalid email or password.";
        const key = await primaryRoleKey().catch(() => "");
        const next = { email: data.user.email, userId: data.user.id, name: data.user.email, role: appRole(key) };
        setProductionUser({ userId: data.user.id, email: data.user.email, roleKey: key });
        setSession(next);
        setPreviewRole(next.role);
        return null;
      },
      resetPassword: async (email) => {
        if (!supabase) return "Configuration Required. Password reset needs Supabase Auth.";
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
        return error ? error.message : null;
      },
      logout: () => {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        setProductionUser(null);
        setSession(null);
        void supabase?.auth.signOut();
      },
      setPreviewRole,
    }),
    [previewRole, productionUser, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export { supabaseConfigured };

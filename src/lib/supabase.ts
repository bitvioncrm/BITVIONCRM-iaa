import { createClient, type SupabaseClient, type SupportedStorage } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

const REMEMBER_KEY = "bitvion.auth.remember";

/** Prefer localStorage for all-day admin desks; fall back to sessionStorage when Remember me is off. */
function authStorage(): SupportedStorage {
  const remember = () => {
    try {
      return localStorage.getItem(REMEMBER_KEY) !== "0";
    } catch {
      return true;
    }
  };
  return {
    getItem: (key) => {
      try {
        if (remember()) return localStorage.getItem(key) ?? sessionStorage.getItem(key);
        return sessionStorage.getItem(key) ?? localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        if (remember()) {
          localStorage.setItem(key, value);
          sessionStorage.removeItem(key);
        } else {
          sessionStorage.setItem(key, value);
          localStorage.removeItem(key);
        }
      } catch {
        /* ignore quota / private mode */
      }
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export function setAuthRemember(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: authStorage(),
          storageKey: "bitvion.crm.auth",
          // Keep the desk signed in through a full workday via refresh tokens.
          flowType: "pkce",
        },
      })
    : null;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://ynkydtdqlloiuozitzjd.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlua3lkdGRxbGxvaXVveml0empkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MzQyOTUsImV4cCI6MjEwODIxMDI5NX0.DXQWq_LBKBGUWBtEu3Jos7cTLEuWe9ctpW_GugeR-kg";

export const isSupabaseConfigured =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("YOUR_PROJECT_REF") &&
  SUPABASE_ANON_KEY.length > 0 &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");

let authStorage = window.localStorage;
const browserAuthStorage = {
  getItem: (key) => authStorage.getItem(key),
  setItem: (key, value) => authStorage.setItem(key, value),
  removeItem: (key) => authStorage.removeItem(key),
};

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: browserAuthStorage,
      },
    })
  : null;

export function setAuthPersistence(rememberMe) {
  authStorage = rememberMe ? window.localStorage : window.sessionStorage;
}

export function isAdminRow(row) {
  if (!row || typeof row !== "object") return false;
  return (
    row.is_admin === true ||
    row.isAdmin === true ||
    row.data?.isAdmin === true ||
    row.data?.is_admin === true
  );
}


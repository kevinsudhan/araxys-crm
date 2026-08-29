import { createClient } from "@supabase/supabase-js";

/**
 * The v2 Supabase client.
 *
 * This points at v2's OWN project (izgbrdeybhbepftloxgk, ap-south-1), never at
 * the production project that v1 and the live voice agents share. Auth is the
 * only thing it is used for; CRM data still comes from the in-memory mock, so
 * nothing done in this workspace can reach a real shipment.
 *
 * The anon key in the bundle is not a leak. It identifies the project and
 * carries no privileges of its own -- every table it can reach is behind Row
 * Level Security, and the policy on `profiles` lets a signed-in user read only
 * their own row. The key that must never ship is service_role, which bypasses
 * RLS; it is gitignored and used only by the seed script.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required — copy them into .env.local"
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    /**
     * sessionStorage, not the default localStorage.
     *
     * Desk machines are shared. localStorage would keep the CRM signed in after
     * the browser is closed, for whoever opens it next; sessionStorage is scoped
     * to the tab and cleared when it goes. The refresh token is short-lived
     * either way, but where it rests still matters.
     */
    storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

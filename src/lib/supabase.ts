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

    /**
     * Required for OAuth, and previously set to false.
     *
     * Microsoft sends the browser back to this app with the authorisation code
     * in the URL. If the client is told not to look there, the redirect lands on
     * a page that quietly does nothing: no session, no error, no clue why. That
     * was a safe default while sign-in was email and password only, and became
     * a silent breakage the moment Microsoft was added.
     */
    detectSessionInUrl: true,

    /**
     * PKCE rather than the implicit flow. The code arrives as a query parameter
     * and is exchanged for tokens, so no access token is ever written into the
     * URL bar, browser history, or a Referer header on the way out.
     */
    flowType: "pkce",
  },
});

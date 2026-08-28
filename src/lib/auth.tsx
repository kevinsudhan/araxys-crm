import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Sign-in for the CRM.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE PUTTING IT IN FRONT OF REAL CUSTOMER DATA.
 *
 * The credentials below ship inside the JavaScript bundle. Anything in the
 * bundle is readable by anyone who opens the site -- view-source, devtools, or
 * curl on the .js file will show these addresses and passwords in plain text.
 * No amount of hashing or obfuscation on this side changes that, because the
 * check itself runs on the visitor's machine and they control it.
 *
 * That every account currently shares one password makes it worse, not better:
 * one address learned is every address learned.
 *
 * So this is a DEMO GATE. It keeps the two roles apart, gives the app a real
 * sign-in flow to show, and stops a casual visitor wandering into the CRM. It
 * is not authentication and must not be treated as any.
 *
 * The real version is Supabase Auth: users in auth.users, the role in a
 * profiles table, and Row Level Security so the database itself refuses to
 * serve rows to the wrong person. That moves the decision to the server, where
 * the visitor cannot reach it, and lets each person hold their own password.
 * Until then, assume every page here is public.
 * ---------------------------------------------------------------------------
 */

export type Role = "admin" | "employee";

export interface Session {
  email: string;
  /** Display name for the header. */
  name: string;
  role: Role;
  signedInAt: number;
}

/**
 * Desk accounts. Delete this whole block when Supabase Auth lands.
 *
 * One shared starter password, to be replaced per-person before this is used
 * for anything real. `aashish@` is the administrator; the shared desk addresses
 * (`info@`, `imports@`) are ordinary employee accounts, since a mailbox several
 * people read is the last thing that should hold admin rights.
 */
const SHARED_STARTER_PASSWORD = "Junior@123";

const ACCOUNTS: Array<{ email: string; password: string; name: string; role: Role }> = [
  { email: "aashish@aashishlogistics.com", password: SHARED_STARTER_PASSWORD, name: "Aashish", role: "admin" },
  { email: "parasu@aashishlogistics.com", password: SHARED_STARTER_PASSWORD, name: "Parasu", role: "employee" },
  { email: "aarathy@aashishlogistics.com", password: SHARED_STARTER_PASSWORD, name: "Aarathy", role: "employee" },
  { email: "info@aashishlogistics.com", password: SHARED_STARTER_PASSWORD, name: "Info Desk", role: "employee" },
  { email: "imports@aashishlogistics.com", password: SHARED_STARTER_PASSWORD, name: "Imports Desk", role: "employee" },
];

const STORAGE_KEY = "araxys.session";

/**
 * Sessions live in sessionStorage, not localStorage.
 *
 * sessionStorage is scoped to the tab and cleared when it closes, so walking
 * away from a shared desk machine does not leave the CRM signed in for the next
 * person who opens the browser.
 */
const IDLE_LIMIT_MS = 30 * 60 * 1000;

interface AuthValue {
  session: Session | null;
  /** Returns an error message, or null when the sign-in succeeded. */
  signIn: (email: string, password: string, expectedRole: Role) => string | null;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function readStoredSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.email || !parsed?.role) return null;
    // An abandoned tab should not stay signed in indefinitely.
    if (Date.now() - parsed.signedInAt > IDLE_LIMIT_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(readStoredSession);
  const timer = useRef<number | null>(null);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const signIn = useCallback((email: string, password: string, expectedRole: Role) => {
    const e = email.trim().toLowerCase();
    const account = ACCOUNTS.find((a) => a.email === e && a.password === password);

    // One message for both failure modes. Saying "no such account" tells someone
    // probing the form which half they got right.
    if (!account) return "Incorrect email or password.";

    /**
     * The role is checked against the door they came in through, so an employee
     * cannot obtain an admin session by signing in on the admin form, and vice
     * versa. Without this the two pages would be cosmetic.
     */
    if (account.role !== expectedRole) {
      return expectedRole === "admin"
        ? "This account does not have admin access. Use the employee sign-in."
        : "This is an admin account. Use the admin sign-in.";
    }

    const next: Session = {
      email: account.email,
      name: account.name,
      role: account.role,
      signedInAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    return null;
  }, []);

  /** Sign out after a period of no interaction, refreshed on real activity. */
  useEffect(() => {
    if (!session) return;

    const reset = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(signOut, IDLE_LIMIT_MS);
    };

    const events: Array<keyof WindowEventMap> = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [session, signOut]);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

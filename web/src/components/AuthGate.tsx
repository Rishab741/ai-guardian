"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSupabaseSession } from "@/lib/useSupabaseSession";

/**
 * Demo mode: no-op, renders immediately — the frictionless, open behavior
 * the app has always had for sales demos is untouched.
 *
 * Production mode (backend reports demo_mode: false): requires an active
 * Supabase session on every route except /login, redirecting there if
 * there isn't one. Checked client-side (not Next.js middleware) since every
 * page here is already a client component with no server-rendered,
 * session-dependent content — a middleware/SSR round trip would add
 * latency and a new failure mode without protecting anything extra.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const { session, loaded } = useSupabaseSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    api
      .health()
      .then((h) => setDemoMode(h.demo_mode))
      .catch(() => setDemoMode(true)); // backend unreachable — don't lock the user out, let pages surface their own error state
  }, []);

  useEffect(() => {
    if (demoMode === false && loaded && !session && pathname !== "/login") {
      router.replace("/login");
    }
  }, [demoMode, loaded, session, pathname, router]);

  // Nothing to gate on yet, or gating doesn't apply here — render normally.
  if (demoMode !== false || pathname === "/login" || session || !loaded) {
    return <>{children}</>;
  }
  return null; // brief blank frame while the redirect above fires
}

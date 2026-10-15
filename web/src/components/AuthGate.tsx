"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { hasSession, setFirebaseConfig, signOut as clearSession } from "@/lib/auth";
import type { Me } from "@/lib/types";

/** Which permission each console page needs. Pages not listed are open to
 * any signed-in user. The gateway enforces the same rules on every API call;
 * this only decides what to render. */
export const ROUTE_PERMISSIONS: Record<string, { perm: string; label: string; audience: string }> = {
  "/dashboard": { perm: "view_dashboards", label: "Command Centre", audience: "executives, CISO, compliance and IT admins" },
  "/risk": { perm: "view_risk", label: "People & Apps", audience: "executives, the CISO and compliance" },
  "/policies": { perm: "view_dashboards", label: "Policies", audience: "executives, CISO, compliance and IT admins" },
  "/reports": { perm: "export_reports", label: "Evidence Pack", audience: "the CISO and compliance" },
  "/discovery": { perm: "view_dashboards", label: "Discovery Report", audience: "executives, CISO, compliance and IT admins" },
  "/chat": { perm: "use_playground", label: "Gateway Playground", audience: "the CISO, IT admins and developers" },
  "/setup": { perm: "manage_settings", label: "Setup", audience: "IT admins" },
};

type SessionCtx = { me: Me | null; can: (perm: string) => boolean; signOut: () => Promise<void> };
const Ctx = createContext<SessionCtx>({ me: null, can: () => false, signOut: async () => {} });
export const useSession = () => useContext(Ctx);

export function landingPath(me: Me): string {
  const order = ["/dashboard", "/discovery", "/chat"];
  return order.find((p) => me.permissions.includes(ROUTE_PERMISSIONS[p].perm)) ?? "/dashboard";
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const onLogin = pathname === "/login";

  const signOut = useCallback(async () => {
    await clearSession();
    setMe(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const handler = () => {
      setMe(null);
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    };
    window.addEventListener("sf:signed-out", handler);
    return () => window.removeEventListener("sf:signed-out", handler);
  }, [router]);

  useEffect(() => {
    if (onLogin) return;
    if (!hasSession()) {
      router.replace(`/login?next=${encodeURIComponent(pathname ?? "/")}`);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Firebase sessions need the SDK configured before a token can be read.
        setFirebaseConfig((await api.authConfig()).firebase);
        const who = await api.me();
        if (!cancelled) setMe(who);
      } catch {
        // 401 already redirected via sf:signed-out; anything else, retry from sign-in.
        if (!cancelled) router.replace("/login");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-check identity only when moving between the login page and the app.
  }, [onLogin]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = useCallback((perm: string) => !!me?.permissions.includes(perm), [me]);

  if (!onLogin && (!ready || !me)) return <div className="h-screen bg-[var(--surface-page)]" />;
  return <Ctx.Provider value={{ me, can, signOut }}>{children}</Ctx.Provider>;
}

/** Wraps page content: renders it, or the restricted panel if the signed-in
 * role lacks the page's permission. */
export function PageGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, can } = useSession();
  const rule = Object.entries(ROUTE_PERMISSIONS).find(([p]) => pathname === p || pathname?.startsWith(p + "/"))?.[1];
  if (!me || !rule || can(rule.perm)) return <>{children}</>;
  return <Restricted label={rule.label} audience={rule.audience} me={me} />;
}

function Restricted({ label, audience, me }: { label: string; audience: string; me: Me }) {
  return (
    <div className="flex-1 overflow-y-auto px-4">
      <div className="fade-up mx-auto mt-24 max-w-md rounded-2xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-7 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--status-critical)_12%,transparent)] text-[var(--status-critical)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="10.5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="mt-4 text-[16px] font-semibold text-[var(--text-primary)]">{label} is restricted</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          You&apos;re signed in as <span className="font-medium text-[var(--text-primary)]">{me.display_name}</span> ({me.role_label}).
          This view is available to {audience}. The gateway enforces the same rule on every API call, so the data
          can&apos;t be reached another way.
        </p>
        <Link
          href={landingPath(me)}
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-[var(--brand)] px-4 text-[13px] font-medium text-[var(--brand-ink)]"
        >
          Go to my workspace
        </Link>
      </div>
    </div>
  );
}

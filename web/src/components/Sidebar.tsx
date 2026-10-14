"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { createClient } from "@/lib/supabase/client";
import { api } from "@/lib/api";

const NAV = [
  { href: "/chat", label: "AI Chat Console", icon: ChatIcon },
  { href: "/dashboard", label: "Executive Dashboard", icon: DashboardIcon },
  { href: "/discovery", label: "CISO Discovery Report", icon: ShieldIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme, resolvedDark } = useTheme();
  const { session } = useSupabaseSession();
  const [demoMode, setDemoMode] = useState(true);

  useEffect(() => {
    api
      .health()
      .then((h) => setDemoMode(h.demo_mode))
      .catch(() => {});
  }, []);

  async function signOut() {
    try {
      await createClient().auth.signOut();
    } catch {}
    router.replace("/login");
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-[var(--brand-ink)]">
          <FabricIcon />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight text-[var(--text-primary)]">SovereignFabric</div>
          <div className="text-[11px] leading-tight text-[var(--text-muted)]">AI Control Gateway</div>
        </div>
      </div>

      <div className="px-3">
        <button
          onClick={() => window.dispatchEvent(new Event("sf:toggle-palette"))}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Quick actions
          <kbd className="ml-auto rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1.5 py-0.5 text-[10px] font-medium">
            &#8984;K
          </kbd>
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-3 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-[color-mix(in_srgb,var(--brand)_11%,transparent)] text-[var(--brand)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
              }`}
            >
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--brand)]" />}
              <Icon active={active} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-2">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
        >
          {resolvedDark ? <MoonIcon /> : <SunIcon />}
          {theme === "system" ? "System theme" : theme === "dark" ? "Dark theme" : "Light theme"}
        </button>
      </div>

      {session && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-2">
          <span className="truncate text-[11.5px] font-medium text-[var(--text-secondary)]" title={session.user.email}>
            {session.user.email}
          </span>
          <button
            onClick={signOut}
            className="shrink-0 text-[11px] font-medium text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-secondary)]"
          >
            Sign out
          </button>
        </div>
      )}

      <div className="mx-3 mb-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
          <span className={`h-1.5 w-1.5 rounded-full ${demoMode ? "pulse-dot bg-[var(--status-good)]" : "bg-[var(--brand)]"}`} />
          {demoMode ? "Demo mode · local pipeline" : "Production · live pipeline"}
        </div>
        <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
          {demoMode
            ? "Zero-copy proxy simulation. No external vendor calls are made."
            : "Real Gemini calls, Postgres audit store, pgvector semantic cache."}
        </div>
      </div>
    </aside>
  );
}

function FabricIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 12a8 8 0 0 1-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" opacity={active ? 1 : 0.85}>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashboardIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" opacity={active ? 1 : 0.85}>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ShieldIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" opacity={active ? 1 : 0.85}>
      <path
        d="M12 3.5 19 6v6c0 4.5-3 7.7-7 8.5-4-.8-7-4-7-8.5V6l7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/chat", label: "AI Chat Console", icon: ChatIcon },
  { href: "/dashboard", label: "Executive Dashboard", icon: DashboardIcon },
  { href: "/discovery", label: "CISO Discovery Report", icon: ShieldIcon },
];

export function Sidebar() {
  const pathname = usePathname();

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

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-[var(--brand)] text-[var(--brand-ink)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon active={active} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-3 mb-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--status-good)]" />
          Demo mode &middot; local pipeline
        </div>
        <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
          Zero-copy proxy simulation. No external vendor calls are made.
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

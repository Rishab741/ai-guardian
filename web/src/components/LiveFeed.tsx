"use client";

import Link from "next/link";
import { useLiveFeed } from "@/lib/useLiveFeed";
import { departmentColor } from "@/lib/palette";
import { useSession } from "@/components/AuthGate";
import { Empty, Panel, timeAgo } from "@/components/ui";
import type { FeedEvent } from "@/lib/types";

export function LiveFeed() {
  const { events, connected } = useLiveFeed(30);
  const { can } = useSession();
  return (
    <Panel
      title="Live activity"
      aside={
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "pulse-dot bg-[var(--status-good)]" : "bg-[var(--status-warning)]"}`} />
          {connected ? "streaming" : "connecting…"}
        </span>
      }
    >
      {events.length === 0 ? (
        <Empty>Waiting for AI traffic. Every request through the gateway appears here the moment it is audited.</Empty>
      ) : (
        <ul className="flex max-h-[360px] flex-col overflow-y-auto">
          {events.map((e) => (
            <FeedRow key={e.id} e={e} linkable={can("view_risk")} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FeedRow({ e, linkable }: { e: FeedEvent; linkable: boolean }) {
  const blocked = e.decision === "blocked";
  const who =
    linkable && e.end_user_id && e.source !== "console" ? (
      <Link href={`/risk?person=${encodeURIComponent(e.end_user_id)}`} className="font-medium text-[var(--text-primary)] hover:underline">
        {e.user_label}
      </Link>
    ) : (
      <span className="font-medium text-[var(--text-primary)]">{e.user_label}</span>
    );
  return (
    <li className="fade-up flex items-start gap-3 border-b border-[var(--border-hairline)] py-2.5 last:border-0">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: departmentColor(e.department) }} />
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          {who}
          <span>via {e.app_name ?? "Console"}</span>
          <span className="text-[var(--text-muted)]">· {e.department_label}</span>
          {e.source === "simulator" && (
            <span className="rounded border border-[var(--border-hairline)] px-1 text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]" title="Simulated traffic from the presenter panel">
              sim
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={
              blocked
                ? { color: "var(--status-critical)", background: "color-mix(in srgb, var(--status-critical) 13%, transparent)" }
                : { color: "var(--status-good-contrast-text)", background: "color-mix(in srgb, var(--status-good) 13%, transparent)" }
            }
          >
            {blocked ? "Blocked" : e.cache_hit ? "Allowed · cache" : "Allowed"}
          </span>
          {[...new Set(e.pii_types)].map((t) => (
            <span key={t} className="rounded-md border border-[var(--border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
              {t}
            </span>
          ))}
          {e.flags.includes("prompt_injection") && (
            <span className="rounded-md bg-[color-mix(in_srgb,var(--status-warning)_22%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-primary)]">
              injection attempt
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">{timeAgo(e.ts)}</span>
    </li>
  );
}

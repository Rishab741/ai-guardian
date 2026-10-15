"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AppStat, PersonProfile, RiskyUser } from "@/lib/types";
import { BarList } from "@/components/charts/BarList";
import { piiTypeColor } from "@/lib/palette";
import { Empty, PageHeader, Panel, timeAgo } from "@/components/ui";

const WINDOWS = [7, 30, 90];

export default function RiskPage() {
  const [days, setDays] = useState(30);
  const [people, setPeople] = useState<RiskyUser[] | null>(null);
  const [apps, setApps] = useState<AppStat[] | null>(null);
  // Pages mount only after sign-in on the client, so reading the URL here is safe.
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("person"),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.riskyUsers(days, 12), api.apps(days)])
      .then(([u, a]) => {
        setPeople(u);
        setApps(a);
      })
      .catch((e) => setError(e.message));
  }, [days]);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    const url = id ? `/risk?person=${encodeURIComponent(id)}` : "/risk";
    window.history.replaceState(null, "", url);
  }, []);

  const maxScore = Math.max(1, ...(people ?? []).map((p) => p.risk_score));

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="People & Apps"
        subtitle="Who is sending sensitive data to AI, through which applications, and what the gateway did about it."
        actions={
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={`rounded-md px-2 py-1 text-[11.5px] font-medium ${
                  days === w ? "bg-[var(--brand)] text-[var(--brand-ink)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-1)]"
                }`}
              >
                {w}D
              </button>
            ))}
          </div>
        }
      />
      <div className="grid flex-1 grid-cols-1 gap-4 px-6 py-5 xl:grid-cols-5">
        {error && <div className="text-[12.5px] text-[var(--status-critical)] xl:col-span-5">{error}</div>}

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Panel title="Highest-risk people" aside="risk = blocked × 5 + identifiers sent + injection attempts × 10">
            {!people ? (
              <Empty>Loading…</Empty>
            ) : people.length === 0 ? (
              <Empty>No attributed traffic in this window.</Empty>
            ) : (
              <ul className="flex flex-col">
                {people.map((p) => (
                  <li key={p.user_id}>
                    <button
                      onClick={() => select(p.user_id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-1)] ${
                        selected === p.user_id ? "bg-[color-mix(in_srgb,var(--brand)_9%,transparent)]" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">{p.display_name ?? p.user_id}</span>
                        <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
                          {[p.title, p.department_label].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="w-24 shrink-0">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-1)]">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${(p.risk_score / maxScore) * 100}%`, background: "var(--status-critical)" }}
                          />
                        </span>
                        <span className="mt-1 block text-right text-[11px] tabular-nums text-[var(--text-muted)]">
                          {p.blocked} blocked · {p.pii_exposures} ids
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Applications">
            {!apps ? (
              <Empty>Loading…</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-[var(--border-hairline)] text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
                      <th className="py-2 pr-2 font-medium">App</th>
                      <th className="py-2 pr-2 text-right font-medium">Requests</th>
                      <th className="py-2 pr-2 text-right font-medium">People</th>
                      <th className="py-2 pr-2 text-right font-medium">Blocked</th>
                      <th className="py-2 text-right font-medium">Ids</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((a) => (
                      <tr key={a.app_name} className="border-b border-[var(--border-hairline)] last:border-0">
                        <td className="py-2 pr-2">
                          <span className="block font-medium text-[var(--text-primary)]">{a.app_name}</span>
                          <span className="text-[11px] text-[var(--text-muted)]">last used {timeAgo(a.last_seen)}</span>
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{a.requests.toLocaleString()}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{a.users}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-[var(--status-critical)]">{a.blocked}</td>
                        <td className="py-2 text-right tabular-nums">{a.pii_exposures}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="min-w-0 xl:col-span-3">
          {selected ? (
            <PersonDetail key={`${selected}-${days}`} id={selected} days={days} onClose={() => select(null)} />
          ) : (
            <Panel>
              <Empty>Select a person to see their AI activity over time, the data they exposed and each decision.</Empty>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonDetail({ id, days, onClose }: { id: string; days: number; onClose: () => void }) {
  const [p, setP] = useState<PersonProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.person(id, days).then(setP).catch((e) => setError(e.message));
  }, [id, days]);

  if (error) return <Panel><Empty>{error}</Empty></Panel>;
  if (!p) return <Panel><Empty>Loading…</Empty></Panel>;

  const peak = Math.max(1, ...p.daily.map((d) => d.requests));
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-[var(--text-primary)]">{p.user.display_name}</div>
            <div className="text-[12.5px] text-[var(--text-muted)]">
              {[p.user.title, p.user.department_label].filter(Boolean).join(" · ")}
              {!p.identity_visible && " · name hidden by privacy mode"}
            </div>
          </div>
          <button onClick={onClose} className="text-[12px] text-[var(--text-muted)] underline underline-offset-2">
            Close
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Requests", p.totals.requests, "neutral"],
            ["Blocked", p.totals.blocked, p.totals.blocked ? "critical" : "neutral"],
            ["Identifiers sent", p.totals.pii_exposures, "neutral"],
            ["Injection attempts", p.totals.injection_flags, p.totals.injection_flags ? "critical" : "neutral"],
          ].map(([label, value, tone]) => (
            <div key={label as string} className="rounded-lg bg-[var(--surface-1)] px-3 py-2.5">
              <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
              <div
                className="text-[20px] font-semibold tabular-nums"
                style={{ color: tone === "critical" ? "var(--status-critical)" : "var(--text-primary)" }}
              >
                {value as number}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={`Daily activity · last ${days} days`} aside="red = blocked">
          {p.daily.length === 0 ? (
            <Empty>No activity.</Empty>
          ) : (
            <svg viewBox={`0 0 ${p.daily.length * 10} 80`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Requests per day">
              {p.daily.map((d, i) => {
                const h = (d.requests / peak) * 76;
                const hb = (d.blocked / peak) * 76;
                return (
                  <g key={d.day}>
                    <title>{`${d.day}: ${d.requests} requests, ${d.blocked} blocked`}</title>
                    <rect x={i * 10 + 1} y={80 - h} width={8} height={h} fill="var(--series-1)" opacity={0.75} />
                    <rect x={i * 10 + 1} y={80 - hb} width={8} height={hb} fill="var(--status-critical)" />
                  </g>
                );
              })}
            </svg>
          )}
        </Panel>
        <Panel title="Data classes sent">
          {p.data_classes.length === 0 ? (
            <Empty>No identifiers detected.</Empty>
          ) : (
            <BarList items={p.data_classes.map((c) => ({ label: c.pii_type, value: c.count, color: piiTypeColor(c.pii_type) }))} />
          )}
        </Panel>
      </div>

      <Panel title="Recent requests">
        <ul className="flex flex-col">
          {p.events.map((e) => (
            <li key={e.id} className="border-b border-[var(--border-hairline)] py-2.5 text-[12.5px] last:border-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  {e.app_name ?? "Console"} ·{" "}
                  <span style={{ color: e.decision === "blocked" ? "var(--status-critical)" : "var(--status-good-contrast-text)" }}>
                    {e.decision === "blocked" ? "Blocked" : e.cache_hit ? "Allowed (cache)" : "Allowed"}
                  </span>
                  {e.pii_types.length > 0 && <span className="text-[var(--text-muted)]"> · {[...new Set(e.pii_types)].join(", ")}</span>}
                </span>
                <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{new Date(e.ts).toLocaleString()}</span>
              </div>
              <div className="mt-1 truncate font-mono text-[11.5px] text-[var(--text-muted)]" title={e.prompt_redacted}>
                {e.prompt_redacted}
              </div>
              {e.policy_reason && <div className="mt-0.5 text-[11.5px] text-[var(--status-critical)]">{e.policy_reason}</div>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

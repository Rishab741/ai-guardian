"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DailyPoint, DepartmentBreakdown, PiiTypeBreakdown, PolicyVersion, SummaryStats } from "@/lib/types";
import { StatCard } from "@/components/StatCard";
import { BarList } from "@/components/charts/BarList";
import { TrendChart } from "@/components/charts/TrendChart";
import Link from "next/link";
import { LiveFeed } from "@/components/LiveFeed";
import { useSession } from "@/components/AuthGate";
import { GuidedBanner } from "@/components/GuidedBanner";
import { departmentColor, piiTypeColor } from "@/lib/palette";
import { DASHBOARD_TALKING_POINT } from "@/lib/demoScript";
import { DEFAULT_ROI_EMPLOYEES, DEFAULT_ROI_QUERIES_PER_DAY } from "@/components/EnterpriseValueCalculator";
import { formatCompact } from "@/lib/format";
import type { RoiProjection } from "@/lib/types";

export default function DashboardPage() {
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [depts, setDepts] = useState<DepartmentBreakdown[]>([]);
  const [piiTypes, setPiiTypes] = useState<PiiTypeBreakdown[]>([]);
  const [timeseries, setTimeseries] = useState<DailyPoint[]>([]);
  const [pending, setPending] = useState<PolicyVersion | null>(null);
  const { can } = useSession();
  const [roi, setRoi] = useState<RoiProjection | null>(null);
  const [error, setError] = useState(false);
  const [showGuided, setShowGuided] = useState(false);
  const [rangeDays, setRangeDays] = useState(90);

  useEffect(() => {
    setShowGuided(new URLSearchParams(window.location.search).get("guided") === "1");
  }, []);

  async function load() {
    try {
      const [s, d, p, t, r, versions] = await Promise.all([
        api.summary(),
        api.departmentBreakdown(),
        api.piiTypeBreakdown(),
        api.timeseries(rangeDays),
        api.roiProjection(DEFAULT_ROI_EMPLOYEES, DEFAULT_ROI_QUERIES_PER_DAY),
        api.policies(),
      ]);
      setSummary(s);
      setDepts(d);
      setPiiTypes(p);
      setTimeseries(t);
      setRoi(r);
      setPending(versions.find((v) => v.status === "pending_approval") ?? null);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, [rangeDays]);

  let runningActual = 0;
  let runningNoCache = 0;
  const cumulative = timeseries.map((d) => {
    runningActual += d.cost_usd;
    runningNoCache += d.cost_if_no_cache;
    return { day: d.day, cost_usd: runningActual, cost_if_no_cache: runningNoCache };
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] px-6 py-3.5">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Command Centre</h1>
        <p className="text-[12px] text-[var(--text-muted)]">Every AI request across the organisation: what was protected, what was stopped, and what it cost.</p>
      </header>

      {showGuided && <GuidedBanner text={DASHBOARD_TALKING_POINT} onDismiss={() => setShowGuided(false)} />}

      <div className="flex-1 px-6 py-5">
        {error && (
          <div className="mb-4 rounded-lg border border-[var(--status-critical)]/30 bg-[color-mix(in_srgb,var(--status-critical)_10%,transparent)] px-3.5 py-2.5 text-[12.5px] text-[var(--status-critical)]">
            Cannot reach the AI Control Gateway. Check that the API is running.
          </div>
        )}

        {pending && (
          <Link
            href="/policies"
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color-mix(in_srgb,var(--status-warning)_55%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] px-3.5 py-2.5 text-[12.5px] text-[var(--text-primary)]"
          >
            <span>
              <b>Policy v{pending.version} is waiting for approval</b>
              {pending.note ? ` · “${pending.note}”` : ""} · proposed by {pending.created_by}
            </span>
            <span className="font-medium text-[var(--brand)]">{can("approve_policy") ? "Review and decide →" : "View →"}</span>
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Requests Intercepted"
            loading={!summary}
            numericValue={summary?.total_requests ?? 0}
            format={(v) => Math.round(v).toLocaleString()}
            icon={<InboxIcon />}
          />
          <StatCard
            label="PII Fields Redacted"
            loading={!summary}
            numericValue={summary?.total_pii_redactions ?? 0}
            format={(v) => Math.round(v).toLocaleString()}
            sub="before leaving the gateway"
            icon={<LockIcon />}
          />
          <StatCard
            label="Cache Hit Rate"
            loading={!summary}
            numericValue={(summary?.cache_hit_rate ?? 0) * 100}
            format={(v) => `${v.toFixed(0)}%`}
            sub="model calls avoided"
            icon={<BoltIcon />}
          />
          <StatCard
            label="Projected Annual Value"
            loading={!roi}
            numericValue={roi?.total_annual_value_usd ?? 0}
            format={formatCompact}
            sub="enterprise scale — see Discovery Report"
            accent="good"
            icon={<TrendIcon />}
          />
          <StatCard
            label="Policy Violations Blocked"
            loading={!summary}
            numericValue={summary?.blocked_requests ?? 0}
            format={(v) => Math.round(v).toLocaleString()}
            accent={summary && summary.blocked_requests > 0 ? "critical" : "neutral"}
            icon={<BlockIcon />}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4 xl:col-span-2">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Cumulative FinOps savings from semantic cache</h2>
              <div className="flex gap-1">
                {[
                  { label: "14D", days: 14 },
                  { label: "90D", days: 90 },
                  { label: "1Y", days: 365 },
                ].map((opt) => (
                  <button
                    key={opt.days}
                    onClick={() => setRangeDays(opt.days)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      rangeDays === opt.days
                        ? "bg-[var(--brand)] text-[var(--brand-ink)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {cumulative.length > 0 ? (
              <TrendChart
                data={cumulative}
                xKey="day"
                series={[
                  { key: "cost_if_no_cache", label: "Cost without cache", color: "var(--series-2)" },
                  { key: "cost_usd", label: "Actual cost incurred", color: "var(--series-1)" },
                ]}
                formatValue={(v) => `$${v.toFixed(3)}`}
              />
            ) : (
              <div className="py-10 text-center text-[12.5px] text-[var(--text-muted)]">No data yet.</div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-[var(--text-primary)]">Requests by department</h2>
            <BarList
              items={depts.map((d) => ({
                label: d.department_label,
                value: d.requests,
                color: departmentColor(d.department),
              }))}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-[var(--text-primary)]">PII/PHI types caught</h2>
            {piiTypes.length > 0 ? (
              <BarList items={piiTypes.map((p) => ({ label: p.pii_type, value: p.count, color: piiTypeColor(p.pii_type) }))} />
            ) : (
              <div className="py-6 text-center text-[12.5px] text-[var(--text-muted)]">No detections yet.</div>
            )}
          </div>

          <div className="xl:col-span-2">
            <LiveFeed />
          </div>
        </div>
      </div>
    </div>
  );
}

function InboxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M3 12h5l2 3h4l2-3h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 5h13l2.5 7v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7l2.5-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="11" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function TrendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M3 17l6-6 4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BlockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.3 6.3l11.4 11.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

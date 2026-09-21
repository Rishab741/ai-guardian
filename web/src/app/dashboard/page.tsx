"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuditLog, DailyPoint, DepartmentBreakdown, PiiTypeBreakdown, SummaryStats } from "@/lib/types";
import { StatCard } from "@/components/StatCard";
import { BarList } from "@/components/charts/BarList";
import { TrendChart } from "@/components/charts/TrendChart";
import { AuditTable } from "@/components/AuditTable";
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
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [roi, setRoi] = useState<RoiProjection | null>(null);
  const [error, setError] = useState(false);
  const [showGuided, setShowGuided] = useState(false);
  const [rangeDays, setRangeDays] = useState(90);

  useEffect(() => {
    setShowGuided(new URLSearchParams(window.location.search).get("guided") === "1");
  }, []);

  async function load() {
    try {
      const [s, d, p, t, l, r] = await Promise.all([
        api.summary(),
        api.departmentBreakdown(),
        api.piiTypeBreakdown(),
        api.timeseries(rangeDays),
        api.auditLogs(12),
        api.roiProjection(DEFAULT_ROI_EMPLOYEES, DEFAULT_ROI_QUERIES_PER_DAY),
      ]);
      setSummary(s);
      setDepts(d);
      setPiiTypes(p);
      setTimeseries(t);
      setLogs(l);
      setRoi(r);
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
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Executive Dashboard</h1>
        <p className="text-[12px] text-[var(--text-muted)]">Live view of intercepted AI requests and FinOps savings across the pilot.</p>
      </header>

      {showGuided && <GuidedBanner text={DASHBOARD_TALKING_POINT} onDismiss={() => setShowGuided(false)} />}

      <div className="flex-1 px-6 py-5">
        {error && (
          <div className="mb-4 rounded-lg border border-[var(--status-critical)]/30 bg-[color-mix(in_srgb,var(--status-critical)_10%,transparent)] px-3.5 py-2.5 text-[12.5px] text-[var(--status-critical)]">
            Cannot reach the AI Control Gateway. Is the FastAPI backend running on :8000?
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Requests Intercepted" value={summary ? summary.total_requests.toLocaleString() : "—"} />
          <StatCard
            label="PII Fields Redacted"
            value={summary ? summary.total_pii_redactions.toLocaleString() : "—"}
            sub="before leaving the gateway"
          />
          <StatCard
            label="Cache Hit Rate"
            value={summary ? `${(summary.cache_hit_rate * 100).toFixed(0)}%` : "—"}
            sub="model calls avoided"
          />
          <StatCard
            label="Projected Annual Value"
            value={roi ? formatCompact(roi.total_annual_value_usd) : "—"}
            sub="enterprise scale — see Discovery Report"
            accent="good"
          />
          <StatCard
            label="Policy Violations Blocked"
            value={summary ? summary.blocked_requests.toLocaleString() : "—"}
            accent={summary && summary.blocked_requests > 0 ? "critical" : "neutral"}
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

          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4 xl:col-span-2">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Recent audit activity</h2>
              <span className="text-[11px] text-[var(--text-muted)]">auto-refreshing</span>
            </div>
            <AuditTable logs={logs} />
          </div>
        </div>
      </div>
    </div>
  );
}

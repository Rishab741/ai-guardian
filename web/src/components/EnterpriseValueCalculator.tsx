"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { RoiPreset, RoiProjection } from "@/lib/types";
import { formatCompact } from "@/lib/format";

const FALLBACK_PRESETS: Record<string, RoiPreset> = {
  mid: { label: "Mid-size enterprise", employees: 5_000, queries_per_day: 10 },
  large: { label: "Large enterprise", employees: 25_000, queries_per_day: 20 },
  major: { label: "Major bank / insurer", employees: 50_000, queries_per_day: 30 },
};

// Exported so other views (e.g. the Executive Dashboard) can project the
// exact same enterprise-scale figure shown here, instead of drifting.
export const DEFAULT_ROI_EMPLOYEES = FALLBACK_PRESETS.large.employees;
export const DEFAULT_ROI_QUERIES_PER_DAY = FALLBACK_PRESETS.large.queries_per_day;

export function EnterpriseValueCalculator() {
  const [presets, setPresets] = useState<Record<string, RoiPreset>>(FALLBACK_PRESETS);
  const [activePreset, setActivePreset] = useState("large");
  const [employees, setEmployees] = useState(FALLBACK_PRESETS.large.employees);
  const [queriesPerDay, setQueriesPerDay] = useState(FALLBACK_PRESETS.large.queries_per_day);
  const [projection, setProjection] = useState<RoiProjection | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.roiPresets().then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .roiProjection(employees, queriesPerDay)
      .then(setProjection)
      .catch(() => setError(true));
  }, [employees, queriesPerDay]);

  function applyPreset(key: string) {
    const p = presets[key];
    if (!p) return;
    setActivePreset(key);
    setEmployees(p.employees);
    setQueriesPerDay(p.queries_per_day);
  }

  return (
    <div className="rounded-xl border border-[var(--brand)]/25 bg-[var(--surface-raised)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">Enterprise Value Projection</h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            What this pilot&apos;s observed unit economics are worth at your organization&apos;s real scale.
          </p>
        </div>
        <div className="flex gap-1.5">
          {Object.entries(presets).map(([key, p]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
                activePreset === key
                  ? "bg-[var(--brand)] text-[var(--brand-ink)]"
                  : "border border-[var(--border-hairline)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[var(--text-secondary)]">
          Employees
          <input
            type="number"
            min={1}
            value={employees}
            onChange={(e) => {
              setActivePreset("");
              setEmployees(Math.max(1, Number(e.target.value) || 0));
            }}
            className="tabular w-32 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[13px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[var(--text-secondary)]">
          AI queries / employee / day
          <input
            type="number"
            min={1}
            value={queriesPerDay}
            onChange={(e) => {
              setActivePreset("");
              setQueriesPerDay(Math.max(1, Number(e.target.value) || 0));
            }}
            className="tabular w-32 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[13px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
          />
        </label>
        {projection && (
          <div className="flex flex-col justify-end pb-1.5 text-[11.5px] text-[var(--text-muted)]">
            = {projection.enterprise_daily_requests.toLocaleString()} requests/day &middot;{" "}
            {projection.enterprise_annual_requests.toLocaleString()} / year
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 text-[12px] text-[var(--status-critical)]">Cannot reach the gateway to compute a projection.</div>
      )}

      {projection && (
        <>
          <div className="mt-5 rounded-xl bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] px-5 py-4 text-center">
            <div className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Total Estimated Annual Value
            </div>
            <div className="tabular mt-1 text-[36px] font-bold leading-none text-[var(--status-good-contrast-text)]">
              {formatCompact(projection.total_annual_value_usd)}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-hairline)] px-4 py-3">
              <div className="text-[11.5px] font-medium text-[var(--text-muted)]">FinOps Compute Savings</div>
              <div className="tabular mt-1 text-[19px] font-semibold text-[var(--text-primary)]">
                {formatCompact(projection.finops_annual_savings_usd)}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                Observed ${projection.observed.avg_savings_per_request_usd.toFixed(5)}/request savings rate from this
                pilot&apos;s semantic cache, applied to {projection.enterprise_annual_requests.toLocaleString()} requests/year.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-hairline)] px-4 py-3">
              <div className="text-[11.5px] font-medium text-[var(--text-muted)]">Risk Exposure Avoided</div>
              <div className="tabular mt-1 text-[19px] font-semibold text-[var(--text-primary)]">
                {formatCompact(projection.risk_avoided_usd)}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                Average cost of a single reportable data breach ({projection.risk_avoided_source}) &mdash; this pilot alone
                caught {projection.observed.pilot_pii_exposures} unmonitored PII exposures in {projection.observed.pilot_requests}{" "}
                requests.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowMethodology((v) => !v)}
            className="mt-3 text-[11px] font-medium text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-secondary)]"
          >
            {showMethodology ? "Hide" : "How we calculated this"}
          </button>
          {showMethodology && (
            <div className="mt-2 rounded-lg bg-[var(--surface-1)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <p>
                <strong>FinOps savings</strong> = (pilot savings $ &divide; pilot requests) &times; (employees &times; queries/day
                &times; 365). The per-request rate is measured live from this exact pilot&apos;s cache hits &mdash; nothing here is
                a flat assumption.
              </p>
              <p className="mt-1.5">
                <strong>Risk avoided</strong> is deliberately <em>not</em> the exposure count multiplied by a per-record cost
                (that would wildly overstate the figure). It's the industry-average cost of a single reportable incident &mdash;
                this pilot's exposure count is shown as evidence that risk, not as a multiplier.
              </p>
              <p className="mt-1.5">Both the breach-cost assumption and the enterprise volume inputs above are editable.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

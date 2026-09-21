"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DiscoveryReport } from "@/lib/types";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/Badge";
import { GuidedBanner } from "@/components/GuidedBanner";
import { EnterpriseValueCalculator } from "@/components/EnterpriseValueCalculator";
import { DISCOVERY_TALKING_POINT } from "@/lib/demoScript";

export default function DiscoveryPage() {
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [error, setError] = useState(false);
  const [showGuided, setShowGuided] = useState(false);

  useEffect(() => {
    api
      .discoveryReport()
      .then(setReport)
      .catch(() => setError(true));
    setShowGuided(new URLSearchParams(window.location.search).get("guided") === "1");
  }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] px-6 py-3.5 print:hidden">
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">CISO Discovery Report</h1>
          <p className="text-[12px] text-[var(--text-muted)]">
            Shadow Audit Wedge &mdash; {report?.observed_days ?? 14}-day passive observation pilot.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          Export PDF
        </button>
      </header>

      {showGuided && <GuidedBanner text={DISCOVERY_TALKING_POINT} onDismiss={() => setShowGuided(false)} />}

      <div className="flex-1 px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-[var(--status-critical)]/30 bg-[color-mix(in_srgb,var(--status-critical)_10%,transparent)] px-3.5 py-2.5 text-[12.5px] text-[var(--status-critical)]">
            Cannot reach the AI Control Gateway. Is the FastAPI backend running on :8000?
          </div>
        )}

        {!report ? (
          <div className="mx-auto max-w-4xl">
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-5">
              <div className="skeleton h-3 w-40" />
              <div className="skeleton mt-2.5 h-5 w-80" />
              <div className="skeleton mt-2.5 h-3 w-full max-w-xl" />
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <StatCard key={i} label=" " loading />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="fade-up mx-auto max-w-4xl">
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                SovereignFabric &middot; Shadow Audit Discovery
              </div>
              <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                {report.observed_days}-Day Pilot: Unmonitored AI Data Exposure Assessment
              </h2>
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                Generated from passive observation of {report.summary.total_requests.toLocaleString()} AI requests across
                the last {report.observed_days} days. Findings below reflect sensitive data that would previously have
                flowed to external LLM vendors with no redaction, policy check, or audit trail in place.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                  label="PII Exposures Found"
                  numericValue={report.summary.total_pii_redactions}
                  format={(v) => Math.round(v).toLocaleString()}
                  accent="critical"
                />
                <StatCard
                  label="Policy Violations Blocked"
                  numericValue={report.summary.blocked_requests}
                  format={(v) => Math.round(v).toLocaleString()}
                />
                <StatCard
                  label="Cache Hit Rate"
                  numericValue={report.summary.cache_hit_rate * 100}
                  format={(v) => `${v.toFixed(0)}%`}
                />
                <StatCard
                  label="Pilot Savings (Observed)"
                  numericValue={report.summary.savings_usd}
                  format={(v) => `$${v.toFixed(2)}`}
                  sub={`real, measured over ${report.observed_days} days — see projection below`}
                  accent="good"
                />
              </div>
            </div>

            <div className="mt-5">
              <EnterpriseValueCalculator />
            </div>

            <div className="mt-5">
              <h3 className="mb-2.5 text-[13px] font-semibold text-[var(--text-primary)]">Findings</h3>
              <div className="flex flex-col gap-2">
                {report.findings.length === 0 ? (
                  <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
                    No exposures detected in the current pilot window.
                  </div>
                ) : (
                  report.findings.map((f, i) => (
                    <div key={i} className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={f.severity === "high" ? "critical" : "warning"}>
                          {f.severity === "high" ? "High" : "Medium"}
                        </StatusBadge>
                        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{f.title}</span>
                      </div>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{f.detail}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4">
              <h3 className="mb-2.5 text-[13px] font-semibold text-[var(--text-primary)]">Compliance basis</h3>
              <ul className="flex flex-col gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
                <li>&bull; APRA CPS 230 &mdash; operational resilience: every third-party AI dependency is logged, timed, and traceable.</li>
                <li>&bull; Privacy Act 1988 (Cth) &amp; OAIC guidance &mdash; sensitive identifiers are tokenized before leaving the perimeter.</li>
                <li>&bull; No raw PII is ever persisted in the audit store &mdash; only redacted text and detection metadata.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

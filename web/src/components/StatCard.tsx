"use client";

import { useCountUp } from "@/lib/useCountUp";

export function StatCard({
  label,
  value,
  numericValue,
  format,
  sub,
  accent = "neutral",
  icon,
  loading = false,
}: {
  label: string;
  value?: string;
  /** When provided (with `format`), the card animates toward this value on change. */
  numericValue?: number;
  format?: (v: number) => string;
  sub?: string;
  accent?: "neutral" | "good" | "critical";
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  const accentColor =
    accent === "good" ? "var(--status-good-contrast-text)" : accent === "critical" ? "var(--status-critical)" : "var(--text-primary)";

  const animated = useCountUp(numericValue ?? 0);
  const display = numericValue !== undefined && format ? format(animated) : value ?? "—";

  return (
    <div className="group rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--brand)]/30 hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between">
        <div className="text-[11.5px] font-medium text-[var(--text-muted)]">{label}</div>
        {icon && <span className="text-[var(--text-muted)] opacity-60 transition-opacity group-hover:opacity-100">{icon}</span>}
      </div>
      {loading ? (
        <>
          <div className="skeleton mt-2 h-[22px] w-16" />
          {sub && <div className="skeleton mt-2 h-[11px] w-24" />}
        </>
      ) : (
        <>
          <div className="tabular mt-1 text-[22px] font-semibold leading-none" style={{ color: accentColor }}>
            {display}
          </div>
          {sub && <div className="mt-1.5 text-[11.5px] text-[var(--text-secondary)]">{sub}</div>}
        </>
      )}
    </div>
  );
}

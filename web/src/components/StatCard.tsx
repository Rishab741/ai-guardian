export function StatCard({
  label,
  value,
  sub,
  accent = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "neutral" | "good" | "critical";
}) {
  const accentColor =
    accent === "good" ? "var(--status-good-contrast-text)" : accent === "critical" ? "var(--status-critical)" : "var(--text-primary)";
  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-3.5">
      <div className="text-[11.5px] font-medium text-[var(--text-muted)]">{label}</div>
      <div className="tabular mt-1 text-[22px] font-semibold leading-none" style={{ color: accentColor }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-[var(--text-secondary)]">{sub}</div>}
    </div>
  );
}

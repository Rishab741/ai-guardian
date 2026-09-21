const STATUS_STYLES: Record<string, { fg: string; bg: string }> = {
  good: { fg: "var(--status-good-contrast-text)", bg: "color-mix(in srgb, var(--status-good) 14%, transparent)" },
  warning: { fg: "#8a5a00", bg: "color-mix(in srgb, var(--status-warning) 22%, transparent)" },
  serious: { fg: "#a1431f", bg: "color-mix(in srgb, var(--status-serious) 20%, transparent)" },
  critical: { fg: "var(--status-critical)", bg: "color-mix(in srgb, var(--status-critical) 14%, transparent)" },
  neutral: { fg: "var(--text-secondary)", bg: "var(--surface-1)" },
};

export function StatusBadge({
  status,
  icon,
  children,
}: {
  status: "good" | "warning" | "serious" | "critical" | "neutral";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: style.fg, background: style.bg }}
    >
      {icon}
      {children}
    </span>
  );
}

export function PiiBadge({ type }: { type: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-[var(--text-secondary)]"
      title={`Detected & tokenized: ${type}`}
    >
      <LockIcon />
      {type}
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="11" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

import type { DataAction } from "@/lib/types";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] px-6 py-3.5 print:hidden">
      <div className="min-w-0">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h1>
        <p className="text-[12px] text-[var(--text-muted)]">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4 ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h2>}
          {aside && <div className="text-[11.5px] text-[var(--text-muted)]">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-[12.5px] text-[var(--text-muted)]">{children}</div>;
}

const ACTION_STYLE: Record<DataAction, { label: string; fg: string; bg: string }> = {
  allow: { label: "Allow", fg: "var(--text-secondary)", bg: "var(--surface-1)" },
  redact: { label: "Redact", fg: "var(--brand)", bg: "color-mix(in srgb, var(--brand) 12%, transparent)" },
  block: { label: "Block", fg: "var(--status-critical)", bg: "color-mix(in srgb, var(--status-critical) 13%, transparent)" },
};

export function ActionPill({ action, changed = false }: { action: DataAction; changed?: boolean }) {
  const s = ACTION_STYLE[action];
  return (
    <span
      className={`inline-flex min-w-[58px] justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${changed ? "ring-2 ring-[var(--status-warning)]" : ""}`}
      style={{ color: s.fg, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

export function Button({
  children,
  variant = "secondary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-[var(--brand)] text-[var(--brand-ink)] border-transparent",
    secondary: "bg-[var(--surface-raised)] text-[var(--text-primary)] border-[var(--border-hairline)] hover:border-[var(--brand)]",
    danger: "bg-[var(--surface-raised)] text-[var(--status-critical)] border-[color-mix(in_srgb,var(--status-critical)_40%,transparent)]",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

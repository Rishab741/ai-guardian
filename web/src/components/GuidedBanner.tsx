"use client";

export function GuidedBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="fade-up mx-6 mt-4 flex items-start gap-3 rounded-xl border border-[var(--brand)]/25 bg-[color-mix(in_srgb,var(--brand)_8%,var(--surface-raised))] px-4 py-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-[var(--brand-ink)]">
        i
      </span>
      <p className="flex-1 text-[12.5px] leading-relaxed text-[var(--text-primary)]">
        <span className="font-semibold">Guided demo — </span>
        {text}
      </p>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-secondary)]"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

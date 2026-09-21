import type { PipelineStep } from "@/lib/types";

const STATUS_ICON: Record<PipelineStep["status"], { icon: string; color: string }> = {
  ok: { icon: "✓", color: "var(--status-good)" },
  hit: { icon: "⚡", color: "var(--series-1)" },
  miss: { icon: "○", color: "var(--text-muted)" },
  blocked: { icon: "✕", color: "var(--status-critical)" },
};

export function PipelineTrace({ steps }: { steps: PipelineStep[] }) {
  return (
    <ol className="flex flex-col gap-0">
      {steps.map((s, i) => {
        const meta = STATUS_ICON[s.status];
        const isLast = i === steps.length - 1;
        return (
          <li key={s.step} className="relative flex gap-3 pb-3 last:pb-0">
            {!isLast && (
              <span
                className="absolute left-[9px] top-5 h-[calc(100%-8px)] w-px"
                style={{ background: "var(--gridline)" }}
              />
            )}
            <span
              className="relative z-10 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={{
                color: s.status === "ok" || s.status === "hit" ? "#fff" : meta.color,
                background: s.status === "ok" || s.status === "hit" ? meta.color : "var(--surface-1)",
                border: s.status === "ok" || s.status === "hit" ? "none" : `1.5px solid ${meta.color}`,
              }}
            >
              {meta.icon}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">{s.label}</div>
              <div className="text-[12px] leading-snug text-[var(--text-secondary)]">{s.detail}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

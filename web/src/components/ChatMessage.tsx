"use client";

import { useState } from "react";
import type { ChatResponse } from "@/lib/types";
import { PiiBadge, StatusBadge } from "@/components/Badge";
import { PipelineTrace } from "@/components/PipelineTrace";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="fade-up flex justify-end">
      <div className="max-w-[70%] rounded-2xl rounded-br-md bg-[var(--brand)] px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--brand-ink)]">
        {text}
      </div>
    </div>
  );
}

export function AssistantBubble({ result }: { result: ChatResponse }) {
  const [showTrace, setShowTrace] = useState(false);

  return (
    <div className="fade-up flex justify-start">
      <div className="max-w-[78%] rounded-2xl rounded-bl-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-3">
        {!result.allowed ? (
          <div className="flex items-start gap-2">
            <StatusBadge status="critical" icon={<CrossIcon />}>
              Blocked by policy
            </StatusBadge>
          </div>
        ) : null}

        <p className={`text-[13.5px] leading-relaxed text-[var(--text-primary)] ${!result.allowed ? "mt-2" : ""}`}>
          {result.response}
        </p>

        {result.redactions.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {result.redactions.map((r, i) => (
              <PiiBadge key={i} type={r.pii_type} />
            ))}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {result.allowed && (
            <StatusBadge status={result.cache_hit ? "good" : "neutral"} icon={result.cache_hit ? <BoltIcon /> : undefined}>
              {result.cache_hit ? "Served from semantic cache" : `Routed → ${result.model_used}`}
            </StatusBadge>
          )}
          {result.allowed && (
            <span className="tabular text-[11px] text-[var(--text-muted)]">
              ${result.cost_usd.toFixed(5)} &middot; {result.latency_ms}ms
            </span>
          )}
          <button
            onClick={() => setShowTrace((v) => !v)}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-secondary)]"
          >
            {showTrace ? "Hide" : "View"} compliance pipeline
            <ChevronIcon open={showTrace} />
          </button>
        </div>

        {showTrace && (
          <div className="mt-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-3">
            <PipelineTrace steps={result.pipeline} />
            <div className="mt-1 border-t border-[var(--border-hairline)] pt-2 text-[10.5px] text-[var(--text-muted)]">
              Audit record #{result.audit_id} &middot; {result.department_label}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BoltIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      className="transition-transform"
      style={{ transform: open ? "rotate(180deg)" : "none" }}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Empty, PageHeader } from "@/components/ui";
import type { EvidencePack } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = {
  platform_admin: "Platform admin",
  executive: "Executive",
  ciso: "CISO",
  compliance: "Compliance",
  tenant_admin: "IT admin",
  developer: "Developer",
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.evidence(days).then(setPack).catch((e) => setError(e.message));
  }, [days]);
  const current = pack && pack.period.days === days ? pack : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto print:h-auto print:overflow-visible">
      <PageHeader
        title="Evidence Pack"
        subtitle="Audit-trail evidence arranged by APRA CPS 234 and CPS 230 control areas, ready to print or save as PDF."
        actions={
          <>
            <select
              id="evidence-window"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-8 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 text-[12.5px]"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Button variant="primary" onClick={() => window.print()} disabled={!current}>
              Print / save as PDF
            </Button>
          </>
        }
      />
      <div className="flex-1 px-6 py-6 print:p-0">
        {error && <div className="text-[12.5px] text-[var(--status-critical)]">{error}</div>}
        {!current ? <Empty>Assembling evidence…</Empty> : <Report pack={current} />}
      </div>
    </div>
  );
}

function Report({ pack }: { pack: EvidencePack }) {
  const s = pack.summary;
  const c = pack.cps234;
  const r = pack.cps230;
  return (
    <article className="mx-auto max-w-[880px] rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-8 py-8 text-[13px] leading-relaxed text-[var(--text-secondary)] print:max-w-none print:border-0 print:px-0 print:py-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">AI usage evidence pack</div>
      <h1 className="mt-1 text-[22px] font-semibold leading-tight text-[var(--text-primary)]">{pack.tenant}</h1>
      <p className="mt-1">
        Period {fmtDate(pack.period.from)} to {fmtDate(pack.period.to)} ({pack.period.days} days) · generated {new Date(pack.generated_at).toLocaleString()} by SovereignFabric AI Control Gateway
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["AI requests governed", s.total_requests.toLocaleString()],
          ["Identifiers protected", s.total_pii_redactions.toLocaleString()],
          ["Requests blocked", s.blocked_requests.toLocaleString()],
          ["Audit chain", c.audit_integrity.ok ? `Intact · ${c.audit_integrity.checked.toLocaleString()} records` : `Break at #${c.audit_integrity.first_bad_id}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-[var(--surface-1)] px-3 py-2.5">
            <dt className="text-[11px] text-[var(--text-muted)]">{k}</dt>
            <dd className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">{v}</dd>
          </div>
        ))}
      </dl>

      <Section n="1" title="CPS 234 · Information security">
        <Sub title="1.1 Information assets and classification">
          <p>Sensitive identifiers detected in AI requests. Each was replaced with a token before the request left the organisation; real values were restored to the requesting user only where policy allows.</p>
          <Table
            head={["Data class", "Occurrences"]}
            rows={c.classification.map((x) => [x.label, x.occurrences.toLocaleString()])}
            empty="No identifiers detected in this period."
          />
        </Sub>
        <Sub title="1.2 Access control">
          <p>
            People with access to the AI governance console. Request attribution: {c.identity_coverage.verified_requests.toLocaleString()} of{" "}
            {c.identity_coverage.total_requests.toLocaleString()} requests carried a verified user identity from the identity provider.
          </p>
          <Table
            head={["Name", "Title", "Role", "Last sign-in"]}
            rows={c.access_control.map((u) => [u.display_name, u.title, ROLE_LABEL[u.role] ?? u.role, fmtDate(u.last_login_at)])}
          />
        </Sub>
        <Sub title="1.3 Detection and response">
          <p>
            {c.detection.blocked_requests.toLocaleString()} requests were blocked under policy and {c.detection.prompt_injection_flags.toLocaleString()} prompt-injection attempts
            were flagged. People with the most policy events:
          </p>
          <Table
            head={["Person", "Department", "Requests", "Blocked", "Identifiers sent"]}
            rows={c.detection.riskiest_users.map((u) => [u.display_name ?? u.user_id, u.department_label, u.requests, u.blocked, u.pii_exposures])}
            empty="No attributed policy events."
          />
        </Sub>
        <Sub title="1.4 Audit trail integrity">
          <p>
            Every request is recorded with a SHA-256 hash that chains to the previous record, so any alteration or deletion breaks the chain.{" "}
            {c.audit_integrity.ok
              ? `The full chain of ${c.audit_integrity.checked.toLocaleString()} records was re-verified when this pack was generated, with no break.`
              : `Verification found a break at record #${c.audit_integrity.first_bad_id}; investigate before relying on this pack.`}{" "}
            Records hold redacted text only; raw identifiers are never stored.
          </p>
        </Sub>
        <Sub title="1.5 Change management">
          <p>Policy versions require approval by a second person before they take effect.</p>
          <Table
            head={["Version", "Status", "Proposed by", "Decided by", "Decided"]}
            rows={c.change_management.policy_versions.map((p) => [
              `v${p.version}`,
              p.status.replace("_", " "),
              p.created_by,
              p.approved_by ?? "—",
              fmtDate(p.approved_at),
            ])}
          />
          <Table
            head={["When", "Who", "Action", "Target"]}
            rows={c.change_management.console_actions.slice(0, 25).map((a) => [new Date(a.ts).toLocaleString(), a.actor, a.action, a.target])}
            empty="No console changes in this period."
          />
        </Sub>
      </Section>

      <Section n="2" title="CPS 230 · Operational risk and service providers">
        <Sub title="2.1 AI model providers">
          <p>Model services used to answer requests in the period, with concentration and reliability. Requests answered from the gateway&apos;s own cache are listed as provider “cache”.</p>
          <Table
            head={["Provider", "Model", "Requests", "Share", "Errors", "p50", "p95"]}
            rows={r.service_providers.map((p) => [
              p.provider,
              p.model_used,
              p.calls.toLocaleString(),
              pct(p.share),
              p.errors,
              `${Math.round(p.p50_ms)} ms`,
              `${Math.round(p.p95_ms)} ms`,
            ])}
          />
        </Sub>
        <Sub title="2.2 Resilience">
          <p>
            {r.resilience.requests_rerouted.toLocaleString()} requests were automatically rerouted to another model because the first choice was busy,
            rate-limited or unavailable, and {r.resilience.served_by_offline_fallback.toLocaleString()} were answered by the offline fallback. {pct(r.resilience.cache_hit_rate)} of
            requests were served from the gateway&apos;s cache without calling a provider.
          </p>
        </Sub>
      </Section>

      <p className="mt-8 border-t border-[var(--border-hairline)] pt-4 text-[11.5px] text-[var(--text-muted)]">
        This pack supports a CPS 234 or CPS 230 review with evidence from the gateway&apos;s audit trail. It is not itself a determination of compliance.
      </p>
    </article>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid-page">
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
        <span className="mr-2 text-[var(--brand)]">{n}</span>
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 break-inside-avoid">
      <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">{title}</h3>
      {children}
    </div>
  );
}

function Table({ head, rows, empty = "None." }: { head: string[]; rows: (string | number)[][]; empty?: string }) {
  if (rows.length === 0) return <p className="text-[var(--text-muted)]">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-[var(--border-hairline)] text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
            {head.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--border-hairline)] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="py-1.5 pr-3 tabular-nums text-[var(--text-primary)]">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

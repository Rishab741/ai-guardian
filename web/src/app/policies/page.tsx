"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/components/AuthGate";
import { ActionPill, Button, Empty, PageHeader, Panel, timeAgo } from "@/components/ui";
import type { DataAction, Department, ImpactResult, PolicyDoc, PolicyVersion, PromptSimulation } from "@/lib/types";

const CLASSES: [string, string][] = [
  ["AU_TFN", "TFN"],
  ["AU_MEDICARE", "Medicare"],
  ["AU_ABN", "ABN"],
  ["CREDIT_CARD", "Card"],
  ["EMAIL", "Email"],
  ["AU_PHONE", "Phone"],
  ["PERSON_NAME", "Name"],
];
const ACTIONS: DataAction[] = ["allow", "redact", "block"];
const TIERS = ["fast", "balanced", "deep"] as const;
const STATUS_LABEL: Record<PolicyVersion["status"], string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  active: "Active",
  superseded: "Superseded",
  rejected: "Rejected",
};

function cell(doc: PolicyDoc, dept: string, cls: string): DataAction {
  const rules = doc.departments[dept]?.data_classes ?? {};
  return rules[cls] ?? rules["*"] ?? "redact";
}

function diff(from: PolicyDoc, to: PolicyDoc, labels: Record<string, string>): string[] {
  const out: string[] = [];
  const depts = new Set([...Object.keys(from.departments), ...Object.keys(to.departments)]);
  for (const d of depts) {
    for (const [cls, name] of [...CLASSES, ["*", "Other identifiers"] as [string, string]]) {
      const a = cell(from, d, cls);
      const b = cell(to, d, cls);
      if (a !== b) out.push(`${labels[d] ?? d} · ${name}: ${a} → ${b}`);
    }
    const ta = from.departments[d]?.max_tier ?? "deep";
    const tb = to.departments[d]?.max_tier ?? "deep";
    if (ta !== tb) out.push(`${labels[d] ?? d} · model tier cap: ${ta} → ${tb}`);
  }
  if (from.global.prompt_injection !== to.global.prompt_injection)
    out.push(`Prompt injection: ${from.global.prompt_injection} → ${to.global.prompt_injection}`);
  const added = to.global.deny_terms.filter((t) => !from.global.deny_terms.includes(t));
  const removed = from.global.deny_terms.filter((t) => !to.global.deny_terms.includes(t));
  if (added.length) out.push(`Restricted terms added: ${added.join(", ")}`);
  if (removed.length) out.push(`Restricted terms removed: ${removed.join(", ")}`);
  const ra = from.global.rehydrate?.CREDIT_CARD ?? true;
  const rb = to.global.rehydrate?.CREDIT_CARD ?? true;
  if (ra !== rb) out.push(`Show card numbers back to users: ${ra ? "yes" : "no"} → ${rb ? "yes" : "no"}`);
  return out;
}

export default function PoliciesPage() {
  const { me, can } = useSession();
  const [versions, setVersions] = useState<PolicyVersion[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [draft, setDraft] = useState<PolicyDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.policies(), api.departments()])
      .then(([v, d]) => {
        setVersions(v);
        setDepartments(d);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const labels = useMemo(() => Object.fromEntries(departments.map((d) => [d.id, d.label])), [departments]);
  const active = versions?.find((v) => v.status === "active") ?? null;
  const pending = versions?.find((v) => v.status === "pending_approval") ?? null;

  function startDraft() {
    if (!active) return;
    const doc = structuredClone(active.doc);
    for (const d of departments) doc.departments[d.id] ??= { data_classes: { "*": "redact" } };
    setDraft(doc);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Policies"
        subtitle="What each department may send to AI models. Changes need a second person to approve before they take effect."
        actions={
          can("draft_policy") && !draft && !pending ? (
            <Button variant="primary" onClick={startDraft} disabled={!active}>
              Propose a change
            </Button>
          ) : null
        }
      />
      <div className="flex flex-1 flex-col gap-4 px-6 py-5">
        {error && <div className="text-[12.5px] text-[var(--status-critical)]">{error}</div>}
        {!versions || !active ? (
          <Empty>Loading…</Empty>
        ) : (
          <>
            {pending && !draft && (
              <PendingCard
                pending={pending}
                active={active}
                labels={labels}
                canDecide={can("approve_policy")}
                isAuthor={pending.created_by === me?.email}
                onDone={load}
              />
            )}
            {draft ? (
              <Editor
                active={active}
                draft={draft}
                setDraft={setDraft}
                departments={departments}
                labels={labels}
                onCancel={() => setDraft(null)}
                onSubmitted={() => {
                  setDraft(null);
                  load();
                }}
              />
            ) : (
              <Matrix doc={active.doc} departments={departments} title={`Active policy · v${active.version}`} />
            )}
            <History versions={versions} />
          </>
        )}
      </div>
    </div>
  );
}

function Matrix({
  doc,
  departments,
  title,
  base,
  onChange,
}: {
  doc: PolicyDoc;
  departments: Department[];
  title: string;
  base?: PolicyDoc;
  onChange?: (dept: string, cls: string, value: string) => void;
}) {
  return (
    <Panel title={title} aside="Allow sends the value as-is · Redact replaces it with a token · Block refuses the request">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border-hairline)] text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
              <th className="py-2 pr-3 font-medium">Department</th>
              {CLASSES.map(([, n]) => (
                <th key={n} className="py-2 px-1 text-center font-medium">{n}</th>
              ))}
              <th className="py-2 px-1 text-center font-medium">Other</th>
              <th className="py-2 pl-2 text-center font-medium">Model cap</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id} className="border-b border-[var(--border-hairline)] last:border-0">
                <td className="py-2 pr-3 font-medium text-[var(--text-primary)]">{d.label}</td>
                {[...CLASSES.map(([c]) => c), "*"].map((cls) => {
                  const value = cell(doc, d.id, cls);
                  const changed = !!base && value !== cell(base, d.id, cls);
                  return (
                    <td key={cls} className="py-1.5 px-1 text-center">
                      {onChange ? (
                        <select
                          aria-label={`${d.label} ${cls}`}
                          value={value}
                          onChange={(e) => onChange(d.id, cls, e.target.value)}
                          className={`rounded-md border bg-[var(--surface-1)] px-1 py-0.5 text-[11.5px] ${
                            changed ? "border-[var(--status-warning)]" : "border-[var(--border-hairline)]"
                          }`}
                        >
                          {ACTIONS.map((a) => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      ) : (
                        <ActionPill action={value} changed={changed} />
                      )}
                    </td>
                  );
                })}
                <td className="py-1.5 pl-2 text-center">
                  {onChange ? (
                    <select
                      aria-label={`${d.label} model cap`}
                      value={doc.departments[d.id]?.max_tier ?? "deep"}
                      onChange={(e) => onChange(d.id, "__tier", e.target.value)}
                      className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1 py-0.5 text-[11.5px]"
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[11.5px] text-[var(--text-secondary)]">{doc.departments[d.id]?.max_tier ?? "deep"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--text-secondary)]">
        <span>Restricted terms: {doc.global.deny_terms.length ? doc.global.deny_terms.join(", ") : "none"}</span>
        <span>Prompt injection: {doc.global.prompt_injection}</span>
        <span>Card numbers shown back to users: {doc.global.rehydrate?.CREDIT_CARD === false ? "no (masked)" : "yes"}</span>
      </div>
    </Panel>
  );
}

function Editor({
  active,
  draft,
  setDraft,
  departments,
  labels,
  onCancel,
  onSubmitted,
}: {
  active: PolicyVersion;
  draft: PolicyDoc;
  setDraft: (d: PolicyDoc) => void;
  departments: Department[];
  labels: Record<string, string>;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState(draft.global.deny_terms.join(", "));
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = diff(active.doc, draft, labels);

  function update(dept: string, cls: string, value: string) {
    const next = structuredClone(draft);
    const rules = (next.departments[dept] ??= { data_classes: { "*": "redact" } });
    if (cls === "__tier") rules.max_tier = value as (typeof TIERS)[number];
    else rules.data_classes[cls] = value as DataAction;
    setDraft(next);
    setImpact(null);
  }

  function setGlobal(patch: Partial<PolicyDoc["global"]>) {
    setDraft({ ...draft, global: { ...draft.global, ...patch } });
    setImpact(null);
  }

  async function estimate() {
    setBusy(true);
    setError(null);
    try {
      setImpact(await api.simulateImpact(draft, 7));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't estimate impact.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.proposePolicy(draft, note);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit.");
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
      <div className="min-w-0 2xl:col-span-2">
        <Matrix doc={draft} base={active.doc} departments={departments} title={`Proposed change to v${active.version}`} onChange={update} />
        <Panel title="Organisation-wide rules" className="mt-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)] md:col-span-3">
              Restricted terms (comma-separated; requests containing them are blocked)
              <input
                id="deny-terms"
                value={terms}
                onChange={(e) => {
                  setTerms(e.target.value);
                  setGlobal({ deny_terms: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) });
                }}
                className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
              Prompt injection attempts
              <select
                id="injection"
                value={draft.global.prompt_injection}
                onChange={(e) => setGlobal({ prompt_injection: e.target.value as PolicyDoc["global"]["prompt_injection"] })}
                className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-[13px]"
              >
                <option value="off">Ignore</option>
                <option value="flag">Flag for review</option>
                <option value="block">Block</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
              Card numbers in answers
              <select
                id="card-rehydrate"
                value={draft.global.rehydrate?.CREDIT_CARD === false ? "mask" : "show"}
                onChange={(e) => setGlobal({ rehydrate: { ...draft.global.rehydrate, CREDIT_CARD: e.target.value === "show" } })}
                className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-[13px]"
              >
                <option value="mask">Mask (•••• 1111)</option>
                <option value="show">Show the full number</option>
              </select>
            </label>
          </div>
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Changes" aside={`${changes.length} change${changes.length === 1 ? "" : "s"}`}>
          {changes.length === 0 ? (
            <Empty>Change a cell to start.</Empty>
          ) : (
            <ul className="flex flex-col gap-1 text-[12.5px] text-[var(--text-secondary)]">
              {changes.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          )}
        </Panel>

        <PromptTester doc={draft} departments={departments} />

        <Panel title="Impact on last week's traffic">
          {impact ? <ImpactView impact={impact} /> : <p className="text-[12.5px] text-[var(--text-muted)]">Replays the past 7 days of requests against this proposal.</p>}
          <Button className="mt-3" onClick={estimate} disabled={busy || changes.length === 0}>
            Estimate impact
          </Button>
        </Panel>

        <Panel title="Submit for approval">
          <textarea
            id="proposal-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this change? The approver sees this."
            rows={3}
            className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-[13px]"
          />
          {error && <div className="mt-2 text-[12px] text-[var(--status-critical)]">{error}</div>}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={submit} disabled={busy || changes.length === 0 || !note.trim()}>
              Submit for approval
            </Button>
            <Button onClick={onCancel} disabled={busy}>
              Discard
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function PromptTester({ doc, departments }: { doc: PolicyDoc; departments: Department[] }) {
  const [dept, setDept] = useState(departments[0]?.id ?? "retail_banking");
  const [prompt, setPrompt] = useState("Email jane.smith@customerbank.com.au her card 4111 1111 1111 1111 statement");
  const [result, setResult] = useState<PromptSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      setResult(await api.simulatePrompt(doc, dept, prompt));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed.");
    }
  }

  return (
    <Panel title="Test a prompt">
      <div className="flex flex-col gap-2">
        <select
          id="test-dept"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-[13px]"
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
        <textarea
          id="test-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-[13px]"
        />
        <Button onClick={run}>Compare current and proposed</Button>
      </div>
      {error && <div className="mt-2 text-[12px] text-[var(--status-critical)]">{error}</div>}
      {result && (
        <div className="mt-3 grid grid-cols-1 gap-2">
          {(["active", "proposed"] as const).map((k) => (
            <div key={k} className="rounded-lg bg-[var(--surface-1)] px-3 py-2 text-[12px]">
              <div className="font-semibold text-[var(--text-primary)]">
                {k === "active" ? "Current policy" : "Proposed"}:{" "}
                <span style={{ color: result[k].allowed ? "var(--status-good-contrast-text)" : "var(--status-critical)" }}>
                  {result[k].allowed ? "allowed" : "blocked"}
                </span>
              </div>
              {result[k].allowed ? (
                <div className="mt-1 font-mono text-[11.5px] text-[var(--text-secondary)]">Sent to model: {result[k].sent_to_model}</div>
              ) : (
                <div className="mt-1 text-[var(--text-secondary)]">{result[k].reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ImpactView({ impact }: { impact: ImpactResult }) {
  return (
    <div className="flex flex-col gap-2 text-[12.5px] text-[var(--text-secondary)]">
      <div className="flex gap-4">
        <span>
          <b className="text-[18px] tabular-nums text-[var(--status-critical)]">+{impact.newly_blocked}</b> newly blocked
        </span>
        <span>
          <b className="text-[18px] tabular-nums text-[var(--status-good-contrast-text)]">{impact.newly_allowed}</b> newly allowed
        </span>
      </div>
      <div>
        Of {impact.replayed.toLocaleString()} requests in the last {impact.window_days} days. Blocked {impact.blocked_before} → {impact.blocked_after}.
      </div>
      {impact.by_department.filter((d) => d.newly_blocked || d.newly_allowed).map((d) => (
        <div key={d.department}>
          {d.department_label}: {d.newly_blocked ? `+${d.newly_blocked} blocked` : ""} {d.newly_allowed ? `${d.newly_allowed} allowed` : ""}
        </div>
      ))}
      <div className="text-[11.5px] text-[var(--text-muted)]">{impact.note}</div>
    </div>
  );
}

function PendingCard({
  pending,
  active,
  labels,
  canDecide,
  isAuthor,
  onDone,
}: {
  pending: PolicyVersion;
  active: PolicyVersion;
  labels: Record<string, string>;
  canDecide: boolean;
  isAuthor: boolean;
  onDone: () => void;
}) {
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = diff(active.doc, pending.doc, labels);

  useEffect(() => {
    api.simulateImpact(pending.doc, 7).then(setImpact).catch(() => {});
  }, [pending]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.decidePolicy(pending.version, approve, note);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record the decision.");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border-2 border-[color-mix(in_srgb,var(--status-warning)_60%,transparent)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Policy v{pending.version} is waiting for approval</h2>
        <span className="text-[12px] text-[var(--text-muted)]">
          proposed by {pending.created_by} · {timeAgo(pending.created_at)}
        </span>
      </div>
      {pending.note && <p className="mt-1 text-[13px] text-[var(--text-secondary)]">“{pending.note}”</p>}
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Changes</div>
          <ul className="flex flex-col gap-1 text-[12.5px] text-[var(--text-secondary)]">
            {changes.length ? changes.map((c) => <li key={c}>• {c}</li>) : <li>No differences from the active policy.</li>}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Impact on last week</div>
          {impact ? <ImpactView impact={impact} /> : <div className="text-[12.5px] text-[var(--text-muted)]">Calculating…</div>}
        </div>
      </div>
      {canDecide && !isAuthor ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border-hairline)] pt-3">
          <input
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the record (optional)"
            className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[13px]"
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => decide(true)} disabled={busy}>
              Approve and activate
            </Button>
            <Button variant="danger" onClick={() => decide(false)} disabled={busy}>
              Reject
            </Button>
          </div>
          {error && <div className="text-[12px] text-[var(--status-critical)]">{error}</div>}
        </div>
      ) : (
        <p className="mt-4 border-t border-[var(--border-hairline)] pt-3 text-[12.5px] text-[var(--text-muted)]">
          {isAuthor
            ? "You proposed this change, so someone else has to approve it (two-person rule)."
            : "An executive approves or rejects this change."}
        </p>
      )}
    </section>
  );
}

function History({ versions }: { versions: PolicyVersion[] }) {
  return (
    <Panel title="Version history">
      <ul className="flex flex-col">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border-hairline)] py-2 text-[12.5px] last:border-0">
            <span className="w-10 font-mono text-[var(--text-primary)]">v{v.version}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
              style={{
                color: v.status === "active" ? "var(--status-good-contrast-text)" : v.status === "rejected" ? "var(--status-critical)" : "var(--text-secondary)",
                background: "var(--surface-1)",
              }}
            >
              {STATUS_LABEL[v.status]}
            </span>
            <span className="text-[var(--text-secondary)]">
              proposed by {v.created_by}
              {v.approved_by && ` · ${v.status === "rejected" ? "rejected" : "approved"} by ${v.approved_by}`}
            </span>
            {v.note && <span className="text-[var(--text-muted)]">“{v.note}”</span>}
            <span className="ml-auto text-[11px] text-[var(--text-muted)]">{new Date(v.created_at).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

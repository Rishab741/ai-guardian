"use client";

import { useCallback, useEffect, useState } from "react";
import { api, BASE_URL } from "@/lib/api";
import { Button, Empty, PageHeader, Panel, timeAgo } from "@/components/ui";
import type { AppInfo, Department, PolicyPack, TenantSettings } from "@/lib/types";

const STEPS = [
  ["organisation", "Organisation"],
  ["sso", "Single sign-on"],
  ["departments", "Departments"],
  ["policy", "Policy baseline"],
  ["app", "Connect an app"],
  ["notice", "Employee notice"],
  ["test", "Send a test request"],
] as const;
type StepId = (typeof STEPS)[number][0];

const DEFAULT_NOTICE =
  "AI tools at work are protected by SovereignFabric. Requests you send to AI assistants are checked against company policy, " +
  "sensitive identifiers such as tax file numbers and card numbers are removed before anything leaves our network, and each " +
  "request is recorded under the Acceptable Use Policy. Records are reviewed by Security and Compliance.";

const input = "rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[13px] text-[var(--text-primary)]";

export default function SetupPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [step, setStep] = useState<StepId>("organisation");
  const [appKey, setAppKey] = useState<string | null>(null);

  const refresh = useCallback(() => api.settings().then(setSettings), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const done = new Set(settings?.onboarding?.completed ?? []);
  async function complete(id: StepId, patch: Partial<TenantSettings> = {}) {
    const completed = [...new Set([...done, id])];
    setSettings(await api.saveSettings({ ...patch, onboarding: { completed } }));
    const idx = STEPS.findIndex(([s]) => s === id);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1][0]);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Setup" subtitle="Connect the organisation to the gateway. Each step can be revisited later." />
      {!settings ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-5 px-6 py-5 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Setup steps">
            <ol className="flex flex-col gap-1">
              {STEPS.map(([id, label], i) => (
                <li key={id}>
                  <button
                    onClick={() => setStep(id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                      step === id ? "bg-[color-mix(in_srgb,var(--brand)_11%,transparent)] font-medium text-[var(--brand)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold ${
                        done.has(id) ? "bg-[var(--status-good)] text-white" : "border border-[var(--border-hairline)] text-[var(--text-muted)]"
                      }`}
                    >
                      {done.has(id) ? "✓" : i + 1}
                    </span>
                    {label}
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-3 px-2.5 text-[11.5px] text-[var(--text-muted)]">{done.size} of {STEPS.length} complete</p>
          </nav>

          <div className="min-w-0 max-w-[760px]">
            {step === "organisation" && <Organisation settings={settings} onDone={(p) => complete("organisation", p)} />}
            {step === "sso" && <Sso settings={settings} onDone={(p) => complete("sso", p)} />}
            {step === "departments" && <Departments onDone={() => complete("departments")} />}
            {step === "policy" && <Policy onDone={() => complete("policy")} />}
            {step === "app" && <ConnectApp onKey={setAppKey} onDone={() => complete("app")} />}
            {step === "notice" && <Notice settings={settings} onDone={(p) => complete("notice", p)} />}
            {step === "test" && <TestRequest appKey={appKey} onDone={() => complete("test")} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Organisation({ settings, onDone }: { settings: TenantSettings; onDone: (p: Partial<TenantSettings>) => void }) {
  const [name, setName] = useState(settings.name);
  const [privacy, setPrivacy] = useState(settings.privacy_mode ?? "named");
  return (
    <Panel title="Organisation">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
          Organisation name
          <input id="org-name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="flex flex-col gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
          <legend className="mb-1 text-[12px] font-medium">What executives see about individuals</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="privacy" checked={privacy === "named"} onChange={() => setPrivacy("named")} className="mt-1" />
            <span><b className="text-[var(--text-primary)]">Names</b> · executives see who sent what, like Security and Compliance do.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="privacy" checked={privacy === "pseudonymous"} onChange={() => setPrivacy("pseudonymous")} className="mt-1" />
            <span><b className="text-[var(--text-primary)]">Pseudonyms</b> · executives see stable codes such as “User 3F2A1C”; only Security and Compliance see names.</span>
          </label>
        </fieldset>
        <div>
          <Button variant="primary" onClick={() => onDone({ name, privacy_mode: privacy })} disabled={name.trim().length < 2}>
            Save and continue
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Sso({ settings, onDone }: { settings: TenantSettings; onDone: (p: Partial<TenantSettings>) => void }) {
  const [provider, setProvider] = useState(settings.sso?.provider ?? "Microsoft Entra ID");
  const [domain, setDomain] = useState(settings.sso?.domain ?? "harbourbank.example");
  const [connecting, setConnecting] = useState(false);
  const connected = settings.sso?.status === "connected";

  async function connect() {
    setConnecting(true);
    await new Promise((r) => setTimeout(r, 900)); // the demo stands in for the provider's consent redirect
    onDone({ sso: { provider, domain, status: "connected" } });
    setConnecting(false);
  }

  return (
    <Panel title="Single sign-on" aside="simulated in this demo">
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
        Console users sign in with the organisation&apos;s identity provider, and apps can forward each employee&apos;s signed identity so every AI
        request is attributed to a verified person.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
          Identity provider
          <select id="sso-provider" className={input} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option>Microsoft Entra ID</option>
            <option>Okta</option>
            <option>Google Workspace</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
          Email domain
          <input id="sso-domain" className={input} value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={connect} disabled={connecting || !domain.includes(".")}>
          {connecting ? "Connecting…" : connected ? "Reconnect" : `Connect ${provider}`}
        </Button>
        {connected && (
          <span className="text-[12.5px] font-medium text-[var(--status-good-contrast-text)]">
            Connected · {settings.sso?.provider} · {settings.sso?.domain}
          </span>
        )}
      </div>
    </Panel>
  );
}

function Departments({ onDone }: { onDone: () => void }) {
  const [list, setList] = useState<Department[]>([]);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.departments().then(setList), []);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setError(null);
    const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    try {
      const r = await api.addDepartment(id, label.trim());
      setNote(r.note);
      setLabel("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the department.");
    }
  }

  return (
    <Panel title="Departments">
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">Policies are set per department. In a live deployment these come from the identity provider&apos;s groups.</p>
      <ul className="mb-3 flex flex-wrap gap-2">
        {list.map((d) => (
          <li key={d.id} className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[12px] text-[var(--text-primary)]">{d.label}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input id="new-dept" className={`${input} min-w-0 flex-1`} placeholder="e.g. Wealth Management" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button onClick={add} disabled={label.trim().length < 2}>Add</Button>
      </div>
      {note && <p className="mt-2 text-[12px] text-[var(--text-muted)]">{note}</p>}
      {error && <p className="mt-2 text-[12px] text-[var(--status-critical)]">{error}</p>}
      <div className="mt-4">
        <Button variant="primary" onClick={onDone}>Continue</Button>
      </div>
    </Panel>
  );
}

function Policy({ onDone }: { onDone: () => void }) {
  const [packs, setPacks] = useState<Record<string, PolicyPack> | null>(null);
  const [chosen, setChosen] = useState("apra_baseline");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.policyPacks().then(setPacks).catch((e) => setError(e.message));
  }, []);

  async function propose() {
    if (!packs) return;
    setError(null);
    try {
      const r = await api.proposePolicy(packs[chosen].doc, `Onboarding baseline: ${packs[chosen].label}`);
      setResult(`Proposed as policy v${r.version}. An executive approves it on the Policies page before it takes effect.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't propose the policy.");
    }
  }

  return (
    <Panel title="Policy baseline">
      {!packs ? (
        <Empty>{error ?? "Loading…"}</Empty>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2">
            {Object.entries(packs).map(([id, p]) => (
              <label
                key={id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${
                  chosen === id ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_7%,transparent)]" : "border-[var(--border-hairline)]"
                }`}
              >
                <input type="radio" name="pack" checked={chosen === id} onChange={() => setChosen(id)} className="mt-1" />
                <span>
                  <span className="block text-[13px] font-semibold text-[var(--text-primary)]">{p.label}</span>
                  <span className="block text-[12.5px] text-[var(--text-secondary)]">{p.summary}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={propose}>Propose for approval</Button>
            {result && <span className="text-[12.5px] text-[var(--status-good-contrast-text)]">{result}</span>}
          </div>
          {error && <p className="mt-2 text-[12px] text-[var(--status-critical)]">{error}</p>}
        </>
      )}
    </Panel>
  );
}

function ConnectApp({ onKey, onDone }: { onKey: (k: string) => void; onDone: () => void }) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("Mortgage Assistant");
  const [dept, setDept] = useState("retail_banking");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.listApps().then(setApps);
    api.departments().then(setDepartments);
  }, []);
  useEffect(load, [load]);

  async function create() {
    setError(null);
    try {
      const r = await api.createApp(name.trim(), dept);
      setCreated({ name: r.name, key: r.api_key });
      onKey(r.api_key);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the app.");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const snippet = created
    ? `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${BASE_URL}/v1",   # the only change\n    api_key="${created.key}",\n)`
    : "";

  return (
    <Panel title="Connect an app">
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
        Each application gets its own key. Developers keep their OpenAI SDK code and change one line: the base URL.
      </p>
      <div className="flex flex-wrap gap-2">
        <input id="app-name" className={`${input} min-w-0 flex-1`} value={name} onChange={(e) => setName(e.target.value)} />
        <select id="app-dept" className={input} value={dept} onChange={(e) => setDept(e.target.value)}>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
        <Button variant="primary" onClick={create} disabled={name.trim().length < 2}>Create app and key</Button>
      </div>
      {error && <p className="mt-2 text-[12px] text-[var(--status-critical)]">{error}</p>}
      {created && (
        <div className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--status-warning)_55%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_9%,transparent)] p-3">
          <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">Key for {created.name}: copy it now, it won&apos;t be shown again</div>
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--surface-1)] p-3 font-mono text-[12px] text-[var(--text-primary)]">{snippet}</pre>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={() => copy(created.key)}>{copied ? "Copied" : "Copy key"}</Button>
            <Button variant="primary" onClick={onDone}>Continue</Button>
          </div>
        </div>
      )}
      <div className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Registered apps</div>
      <ul className="mt-1 flex flex-col">
        {apps.map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--border-hairline)] py-2 text-[12.5px] last:border-0">
            <span className="font-medium text-[var(--text-primary)]">{a.name}</span>
            <span className="font-mono text-[11.5px] text-[var(--text-muted)]">{a.key_prefix ? `${a.key_prefix}…` : "no key"}</span>
            <span className="ml-auto text-[11.5px] text-[var(--text-muted)]">{a.last_used_at ? `used ${timeAgo(a.last_used_at)}` : "never used"}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Notice({ settings, onDone }: { settings: TenantSettings; onDone: (p: Partial<TenantSettings>) => void }) {
  const [text, setText] = useState(settings.employee_notice ?? DEFAULT_NOTICE);
  return (
    <Panel title="Employee notice">
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
        Staff are told their AI requests are governed and recorded. In NSW, written notice is required before computer surveillance starts; apps can
        show this text next to their AI features.
      </p>
      <textarea id="notice" rows={6} className={`${input} w-full`} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-3">
        <Button variant="primary" onClick={() => onDone({ employee_notice: text })} disabled={text.trim().length < 40}>
          Save and continue
        </Button>
      </div>
    </Panel>
  );
}

function TestRequest({ appKey, onDone }: { appKey: string | null; onDone: () => void }) {
  const [key, setKey] = useState(appKey ?? "");
  const [prompt, setPrompt] = useState("Draft a two-line note confirming TFN 123 456 782 is on file for Mr Sam Holt.");
  const [out, setOut] = useState<{ text: string; audit: string | null; redactions: string | null; cache: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.trim()}` },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: prompt }] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? res.statusText);
      setOut({
        text: body.choices[0].message.content,
        audit: res.headers.get("X-SF-Audit-Id"),
        redactions: res.headers.get("X-SF-Redactions"),
        cache: res.headers.get("X-SF-Cache"),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Send a test request">
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
        Calls the gateway exactly as an application would, with the app key from the previous step.
      </p>
      <div className="flex flex-col gap-2">
        <input id="test-key" className={`${input} font-mono`} placeholder="sf-live-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <textarea id="test-request-prompt" rows={3} className={input} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div>
          <Button variant="primary" onClick={send} disabled={busy || !key.trim()}>
            {busy ? "Sending…" : "Send through the gateway"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-[var(--status-critical)]">{error}</p>}
      {out && (
        <div className="mt-4 rounded-lg bg-[var(--surface-1)] p-3 text-[13px]">
          <div className="text-[var(--text-primary)]">{out.text}</div>
          <div className="mt-2 text-[11.5px] text-[var(--status-good-contrast-text)]">
            ✓ {out.redactions ?? 0} identifier(s) tokenized before the model saw them · audit #{out.audit} · cache {out.cache}
          </div>
        </div>
      )}
    </Panel>
  );
}

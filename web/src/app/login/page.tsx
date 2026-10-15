"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setDemoSession, setFirebaseConfig, signInWithGoogle } from "@/lib/auth";
import { landingPath } from "@/components/AuthGate";
import type { AuthConfig, Persona } from "@/lib/types";

const ROLE_TONE: Record<string, string> = {
  executive: "var(--series-1)",
  ciso: "var(--status-critical)",
  compliance: "var(--series-3, var(--series-1))",
  tenant_admin: "var(--status-good)",
  developer: "var(--text-muted)",
  platform_admin: "var(--brand)",
};

export default function LoginPage() {
  const router = useRouter();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [picking, setPicking] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .authConfig()
      .then((c) => {
        setConfig(c);
        setFirebaseConfig(c.firebase);
      })
      .catch(() => setError("Can't reach the gateway. Check that the API is running."));
  }, []);

  async function finish() {
    const me = await api.me();
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next !== "/" && next !== "/login" ? next : landingPath(me));
  }

  async function choosePersona(p: Persona) {
    setError(null);
    setBusy(p.id);
    try {
      const { token } = await api.demoLogin(p.id, accessCode);
      setDemoSession(token);
      await finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setBusy(null);
    }
  }

  async function google() {
    setError(null);
    setBusy("google");
    try {
      await signInWithGoogle();
      await finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-[var(--surface-page)] px-4 py-8">
      <div className="fade-up w-full max-w-[420px] rounded-2xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-6 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.15)]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand)] text-[var(--brand-ink)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M20 12a8 8 0 0 1-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-[var(--text-primary)]">SovereignFabric</div>
            <div className="text-[11px] leading-tight text-[var(--text-muted)]">AI Control Gateway · Executive Console</div>
          </div>
        </div>

        <h1 className="mt-6 text-[16px] font-semibold text-[var(--text-primary)]">Sign in</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          Console access is limited to executives, security, compliance and IT. Staff never see this console; their
          AI apps call the gateway directly.
        </p>

        {config?.demo_mode && (
          <div className="mt-5">
            {config.access_code_required && (
              <label className="mb-3 flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
                Demo access code
                <input
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  autoComplete="off"
                  className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-[13.5px] text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                />
              </label>
            )}

            {!picking ? (
              <button
                onClick={() => setPicking(true)}
                className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] text-[13.5px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--brand)]"
              >
                <KeyIcon />
                Continue with Microsoft Entra ID
              </button>
            ) : (
              <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]">
                <div className="border-b border-[var(--border-hairline)] px-4 py-2.5 text-[12px] font-medium text-[var(--text-secondary)]">
                  Pick an account · Harbour Bank directory
                </div>
                <ul className="max-h-[340px] overflow-y-auto py-1">
                  {config.personas.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => choosePersona(p)}
                        disabled={busy !== null}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-60"
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                          style={{ background: ROLE_TONE[p.role] }}
                        >
                          {p.display_name.split(" ").map((n) => n[0]).join("")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">{p.display_name}</span>
                          <span className="block truncate text-[11.5px] text-[var(--text-muted)]">{p.title}</span>
                        </span>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                          style={{ color: ROLE_TONE[p.role], background: `color-mix(in srgb, ${ROLE_TONE[p.role]} 12%, transparent)` }}
                        >
                          {busy === p.id ? "Signing in…" : p.role_label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-[var(--text-muted)]">
              Single sign-on is simulated in this demo and the directory accounts are fictional. In a deployment this
              button redirects to the bank&apos;s own identity provider.
            </p>
          </div>
        )}

        {config?.firebase && (
          <button
            onClick={google}
            disabled={busy !== null}
            className="mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-[var(--brand)] text-[13.5px] font-medium text-[var(--brand-ink)] transition-opacity disabled:opacity-50"
          >
            {busy === "google" ? "Signing in…" : "Sign in with Google"}
          </button>
        )}

        {config && !config.demo_mode && !config.firebase && (
          <p className="mt-5 text-[12.5px] text-[var(--status-critical)]">
            No sign-in method is configured on this deployment. Set FIREBASE_PROJECT_ID on the gateway.
          </p>
        )}

        {error && <div className="mt-3 text-[12px] text-[var(--status-critical)]">{error}</div>}

        <div className="mt-6 border-t border-[var(--border-hairline)] pt-3 text-[11px] text-[var(--text-muted)]">
          Demo tenant · Harbour Bank (fictional) · synthetic data only
        </div>
      </div>
    </div>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 12h9M18 12v3M15 12v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

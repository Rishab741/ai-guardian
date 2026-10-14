"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setInfo("Account created. If email confirmation is enabled on your Supabase project, check your inbox before signing in.");
        setMode("signin");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.replace("/chat");
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message.includes("Supabase env vars") ? "Auth isn't configured on this deployment." : err.message);
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="fade-up w-full max-w-sm rounded-2xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-6 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.15)]">
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
            <div className="text-[11px] leading-tight text-[var(--text-muted)]">AI Control Gateway</div>
          </div>
        </div>

        <h1 className="mt-5 text-[15px] font-semibold text-[var(--text-primary)]">
          {mode === "signin" ? "Sign in" : "Create an account"}
        </h1>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          {mode === "signin"
            ? "Your department and access level are assigned by an administrator."
            : "You'll get read/chat access once an administrator assigns your department."}
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-[13.5px] text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
              placeholder="you@company.com"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-secondary)]">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-[13.5px] text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
              placeholder="••••••••"
            />
          </label>

          {error && <div className="text-[12px] text-[var(--status-critical)]">{error}</div>}
          {info && <div className="text-[12px] text-[var(--status-good-contrast-text)]">{info}</div>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex h-10 items-center justify-center rounded-lg bg-[var(--brand)] text-[13.5px] font-medium text-[var(--brand-ink)] transition-opacity disabled:opacity-50"
          >
            {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError(null);
            setInfo(null);
          }}
          className="mt-4 text-[12px] font-medium text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-secondary)]"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ChatResponse, Department } from "@/lib/types";
import { AssistantBubble, UserBubble } from "@/components/ChatMessage";
import { DepartmentSelect } from "@/components/DepartmentSelect";
import { CHAT_SCRIPT } from "@/lib/demoScript";
import { DEFAULT_DEPARTMENT_PROMPTS, DEPARTMENT_PROMPTS } from "@/lib/departmentPrompts";
import { departmentColor } from "@/lib/palette";

type Message = { id: string; role: "user"; text: string } | { id: string; role: "assistant"; result: ChatResponse };

export default function ChatPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [department, setDepartment] = useState("retail_banking");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [scriptIndex, setScriptIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);


  useEffect(() => {
    api
      .departments()
      .then(setDepartments)
      .catch(() => setError("Cannot reach the AI Control Gateway. Check that the API is running."));

    const params = new URLSearchParams(window.location.search);
    const dept = params.get("department");
    if (dept) setDepartment(dept);
    if (params.get("openGuided") === "1") setGuidedOpen(true);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
    }
  }

  async function send(text: string, deptOverride?: string) {
    const dept = deptOverride ?? department;
    if (!text.trim() || loading) return;
    setError(null);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text }]);
    setLoading(true);
    try {
      const result = await api.chat(text, dept);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", result }]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(detail ? `Request failed: ${detail}` : "Request failed. Confirm the gateway is running."
      );
    } finally {
      setLoading(false);
    }
  }

  async function playScriptStep() {
    const step = CHAT_SCRIPT[scriptIndex];
    if (!step || loading) return;
    setDepartment(step.department);
    await send(step.prompt, step.department);
    setScriptIndex((i) => i + 1);
  }

  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  async function resetDemoState() {
    setResetting(true);
    setResetMsg(null);
    try {
      const res = await api.resetDemo();
      setMessages([]);
      setScriptIndex(0);
      setDepartment("retail_banking");
      setResetMsg(`Cache cleared (${res.cache_entries_cleared} stale entr${res.cache_entries_cleared === 1 ? "y" : "ies"} removed). Ready for a clean run.`);
    } catch {
      setResetMsg("Could not reach the gateway to reset.");
    } finally {
      setResetting(false);
    }
  }

  function restartScript() {
    setScriptIndex(0);
  }

  const currentStep = CHAT_SCRIPT[scriptIndex];
  const scriptDone = scriptIndex >= CHAT_SCRIPT.length;
  const suggestions = DEPARTMENT_PROMPTS[department] ?? DEFAULT_DEPARTMENT_PROMPTS;
  const activeDeptLabel = departments.find((d) => d.id === department)?.label;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] px-6 py-3.5">
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">AI Chat Console</h1>
          <p className="text-[12px] text-[var(--text-muted)]">
            Every message here is intercepted by the gateway before reaching an external model.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGuidedOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              guidedOpen
                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-ink)]"
                : "border-[var(--border-hairline)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <PlayIcon />
            Guided Demo
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-[var(--text-secondary)]">Acting as</span>
            <DepartmentSelect
              departments={departments}
              value={department}
              onChange={setDepartment}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.length === 0 && (
                <div className="fade-up flex flex-col items-center gap-5 pt-14 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
                        stroke="var(--brand)"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold text-[var(--text-primary)]">
                      Ask as {activeDeptLabel ?? "your department"}
                    </div>
                    <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
                      Try a prompt with sensitive Australian identifiers and watch the gateway redact it live, or open{" "}
                      <button onClick={() => setGuidedOpen(true)} className="font-medium text-[var(--brand)] underline underline-offset-2">
                        Guided Demo
                      </button>{" "}
                      for a scripted walkthrough.
                    </p>
                  </div>
                  <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                    {suggestions.map((s) => (
                      <button
                        key={s.text}
                        onClick={() => send(s.text)}
                        className="group flex flex-col items-start gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3.5 py-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.15)]"
                      >
                        <span className="text-[12.5px] leading-snug text-[var(--text-primary)]">{s.text}</span>
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-[var(--text-muted)]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: departmentColor(department) }} />
                          {s.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) =>
                m.role === "user" ? <UserBubble key={m.id} text={m.text} /> : <AssistantBubble key={m.id} result={m.result} />
              )}

              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-3">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-[var(--status-critical)]/30 bg-[color-mix(in_srgb,var(--status-critical)_10%,transparent)] px-3.5 py-2.5 text-[12.5px] text-[var(--status-critical)]">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-[var(--border-hairline)] bg-[var(--surface-raised)] px-6 py-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="mx-auto flex max-w-3xl items-end gap-2"
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Ask a business question..."
                className="max-h-32 flex-1 resize-none rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3.5 py-2.5 text-[13.5px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--brand)]"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-ink)] transition-all disabled:opacity-40 enabled:hover:scale-105 enabled:active:scale-95"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M4 12h15m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
          </div>
        </div>

        {guidedOpen && (
          <aside className="fade-up flex w-80 shrink-0 flex-col border-l border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Guided Demo</h2>
              <button
                onClick={() => setGuidedOpen(false)}
                className="rounded-md px-1.5 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-raised)]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mb-3 flex gap-1">
              {CHAT_SCRIPT.map((_, i) => (
                <div
                  key={i}
                  className="h-1 flex-1 rounded-full transition-colors"
                  style={{ background: i < scriptIndex ? "var(--status-good)" : i === scriptIndex ? "var(--brand)" : "var(--gridline)" }}
                />
              ))}
            </div>

            <button
              onClick={resetDemoState}
              disabled={resetting}
              className="mb-4 flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] transition-opacity hover:text-[var(--text-primary)] disabled:opacity-50"
              title="Clears the semantic cache and local chat so rehearsal traffic doesn't cause a false cache hit on stage."
            >
              <ResetIcon />
              {resetting ? "Resetting…" : "Reset demo state"}
            </button>
            {resetMsg && <div className="-mt-2 mb-3 text-[11px] leading-snug text-[var(--text-muted)]">{resetMsg}</div>}

            {!scriptDone && currentStep ? (
              <>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  Step {scriptIndex + 1} of {CHAT_SCRIPT.length}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-primary)]">{currentStep.talkingPoint}</p>

                <div className="mt-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-2.5">
                  <div className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Will send as</div>
                  <div className="mt-1 text-[11.5px] font-medium text-[var(--text-secondary)]">
                    {departments.find((d) => d.id === currentStep.department)?.label ?? currentStep.department}
                  </div>
                  <div className="mt-1.5 text-[12px] italic leading-snug text-[var(--text-primary)]">&ldquo;{currentStep.prompt}&rdquo;</div>
                </div>

                <button
                  onClick={playScriptStep}
                  disabled={loading}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 py-2 text-[12.5px] font-medium text-[var(--brand-ink)] transition-opacity disabled:opacity-50"
                >
                  <PlayIcon />
                  Play this step
                </button>
              </>
            ) : (
              <>
                <div className="text-[13px] font-medium text-[var(--text-primary)]">Script complete.</div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                  Continue the narrative on the executive views &mdash; both carry a talking-point banner.
                </p>
                <Link
                  href="/dashboard?guided=1"
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 py-2 text-[12.5px] font-medium text-[var(--brand-ink)]"
                >
                  Continue to Dashboard →
                </Link>
                <Link
                  href="/discovery?guided=1"
                  className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-2 text-[12.5px] font-medium text-[var(--text-secondary)]"
                >
                  View Discovery Report →
                </Link>
              </>
            )}

            <button
              onClick={restartScript}
              className="mt-4 text-[11.5px] font-medium text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-secondary)]"
            >
              Restart script
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7-11-7Z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 12a8 8 0 1 1 2.6 5.9M4 12V7m0 5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

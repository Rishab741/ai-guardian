"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useSession } from "@/components/AuthGate";
import { Button } from "@/components/ui";

type Check = { name: string; ok: boolean; ms: number; detail: string };

/**
 * Presenter controls, shown only in demo mode. Live traffic is driven from
 * the browser (one request every few seconds) because free hosts pause the
 * server between requests; it keeps running while you move between pages.
 */
export function PresenterPanel() {
  const { me } = useSession();
  const [demo, setDemo] = useState(false);
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [warming, setWarming] = useState(false);
  const [scenarios, setScenarios] = useState<Record<string, string>>({});
  const [traffic, setTraffic] = useState(false);
  const [sent, setSent] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.health().then((h) => setDemo(h.demo_mode)).catch(() => {});
  }, []);

  useEffect(() => {
    if (open && demo && Object.keys(scenarios).length === 0) api.scenarios().then(setScenarios).catch(() => {});
  }, [open, demo, scenarios]);

  useEffect(() => {
    if (!traffic) return;
    timer.current = setInterval(() => {
      const n = 1 + Math.floor(Math.random() * 2);
      api.tick(n).then(() => setSent((s) => s + n)).catch(() => setTraffic(false));
    }, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [traffic]);

  if (!demo || !me) return null;

  async function warm() {
    setWarming(true);
    try {
      setChecks((await api.warmup()).checks);
    } catch (e) {
      setChecks([{ name: "Gateway", ok: false, ms: 0, detail: e instanceof Error ? e.message : "unreachable" }]);
    } finally {
      setWarming(false);
    }
  }

  async function scenario(id: string, label: string) {
    await api.tick(1, id);
    setNote(`Sent: ${label}`);
  }

  async function reset() {
    const r = await api.resetDemo();
    setNote(`Cache cleared (${r.cache_entries_cleared} entries)`);
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 print:hidden">
      {open && (
        <div className="mb-2 w-[320px] rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">Presenter</div>
            <button onClick={() => setOpen(false)} className="text-[12px] text-[var(--text-muted)]">Close</button>
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            <Button onClick={warm} disabled={warming}>{warming ? "Warming up…" : "Warm up the stack"}</Button>
            {checks && (
              <ul className="text-[11.5px]">
                {checks.map((c) => (
                  <li key={c.name} className="flex justify-between gap-2">
                    <span style={{ color: c.ok ? "var(--status-good-contrast-text)" : "var(--status-critical)" }}>
                      {c.ok ? "✓" : "✕"} {c.name}
                    </span>
                    <span className="truncate text-[var(--text-muted)]" title={c.detail}>{c.ok ? `${c.ms} ms` : c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <div className="text-[12.5px] font-medium text-[var(--text-primary)]">Live traffic</div>
              <div className="text-[11px] text-[var(--text-muted)]">Fictional staff, marked as simulated · {sent} sent</div>
            </div>
            <button
              role="switch"
              aria-checked={traffic}
              aria-label="Live traffic"
              onClick={() => setTraffic((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition-colors ${traffic ? "bg-[var(--brand)]" : "bg-[var(--gridline)]"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${traffic ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>

          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Trigger a moment</div>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5">
            {Object.entries(scenarios).map(([id, label]) => (
              <Button key={id} onClick={() => scenario(id, label)} className="justify-start">{label}</Button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Button onClick={reset}>Clear cache</Button>
            <Link
              href="/advisor"
              target="_blank"
              className="inline-flex h-8 items-center rounded-lg border border-[var(--border-hairline)] px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:border-[var(--brand)]"
            >
              Open Advisor Assist ↗
            </Link>
          </div>
          {note && <div className="mt-2 text-[11.5px] text-[var(--text-muted)]">{note}</div>}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="ml-auto flex h-9 items-center gap-2 rounded-full bg-[var(--text-primary)] px-4 text-[12.5px] font-medium text-[var(--surface-page)] shadow-lg"
      >
        {traffic && <span className="pulse-dot h-2 w-2 rounded-full bg-[var(--status-good)]" />}
        Presenter
      </button>
    </div>
  );
}

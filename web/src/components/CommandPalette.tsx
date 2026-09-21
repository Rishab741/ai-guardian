"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import { departmentColor } from "@/lib/palette";

type Command = {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  icon: React.ReactNode;
  run: () => void;
};

const DEPARTMENTS = [
  { id: "finance", label: "Finance" },
  { id: "hr", label: "Human Resources" },
  { id: "retail_banking", label: "Retail Banking" },
  { id: "legal_risk", label: "Legal & Risk / Compliance" },
  { id: "technology", label: "Technology" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const commands: Command[] = useMemo(
    () => [
      {
        id: "nav-chat",
        label: "Go to AI Chat Console",
        group: "Navigate",
        icon: <NavIcon />,
        run: () => router.push("/chat"),
      },
      {
        id: "nav-dashboard",
        label: "Go to Executive Dashboard",
        group: "Navigate",
        icon: <NavIcon />,
        run: () => router.push("/dashboard"),
      },
      {
        id: "nav-discovery",
        label: "Go to CISO Discovery Report",
        group: "Navigate",
        icon: <NavIcon />,
        run: () => router.push("/discovery"),
      },
      {
        id: "guided",
        label: "Start Guided Demo",
        group: "Actions",
        keywords: "walkthrough script",
        icon: <PlayIcon />,
        run: () => router.push("/chat?openGuided=1"),
      },
      {
        id: "reset",
        label: "Reset demo state (clear cache)",
        group: "Actions",
        keywords: "clean rehearsal",
        icon: <ResetIcon />,
        run: async () => {
          try {
            const r = await api.resetDemo();
            setToast(`Cache cleared — ${r.cache_entries_cleared} stale entr${r.cache_entries_cleared === 1 ? "y" : "ies"} removed.`);
          } catch {
            setToast("Could not reach the gateway.");
          }
          window.setTimeout(() => setToast(null), 3000);
        },
      },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to light theme" : theme === "light" ? "Switch to system theme" : "Switch to dark theme",
        group: "Actions",
        keywords: "appearance dark light mode",
        icon: <ThemeIcon />,
        run: () => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark"),
      },
      ...DEPARTMENTS.map((d) => ({
        id: `dept-${d.id}`,
        label: `Switch to ${d.label}`,
        group: "Departments",
        keywords: "department acting as",
        icon: <span className="h-2 w-2 rounded-full" style={{ background: departmentColor(d.id) }} />,
        run: () => router.push(`/chat?department=${d.id}`),
      })),
    ],
    [router, theme, setTheme]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => setActiveIdx(0), [query, open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[activeIdx];
        if (cmd) {
          cmd.run();
          setOpen(false);
          setQuery("");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, activeIdx]);

  useEffect(() => {
    function onToggle() {
      setOpen((v) => !v);
    }
    window.addEventListener("sf:toggle-palette", onToggle);
    return () => window.removeEventListener("sf:toggle-palette", onToggle);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  let lastGroup = "";

  return (
    <>
      {open && (
        <div className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="pop-in flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)]"
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--border-hairline)] px-4 py-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-[var(--text-muted)]">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command or search…"
                className="flex-1 bg-transparent text-[13.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <kbd className="rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                esc
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto py-1.5">
              {filtered.length === 0 && (
                <div className="px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">No matching commands.</div>
              )}
              {filtered.map((cmd, i) => {
                const showGroup = cmd.group !== lastGroup;
                lastGroup = cmd.group;
                return (
                  <div key={cmd.id}>
                    {showGroup && (
                      <div className="px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {cmd.group}
                      </div>
                    )}
                    <button
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => {
                        cmd.run();
                        setOpen(false);
                        setQuery("");
                      }}
                      className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[12.5px] transition-colors ${
                        i === activeIdx ? "bg-[var(--brand)] text-[var(--brand-ink)]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      <span className={i === activeIdx ? "opacity-100" : "opacity-70"}>{cmd.icon}</span>
                      {cmd.label}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fade-up fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-2.5 text-[12.5px] font-medium text-[var(--text-primary)] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.25)]">
          {toast}
        </div>
      )}
    </>
  );
}

function NavIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M4 12h16M14 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7-11-7Z" />
    </svg>
  );
}
function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M4 12a8 8 0 1 1 2.6 5.9M4 12V7m0 5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ThemeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A5.4 5.4 0 0 1 12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

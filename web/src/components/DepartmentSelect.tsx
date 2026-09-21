"use client";

import { useEffect, useRef, useState } from "react";
import type { Department } from "@/lib/types";
import { departmentColor } from "@/lib/palette";

const ICONS: Record<string, (props: { color: string }) => React.ReactNode> = {
  finance: ({ color }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M12 2v20M8 6h5.5a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  hr: ({ color }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8" r="3" stroke={color} strokeWidth="2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="17" cy="8" r="2.4" stroke={color} strokeWidth="1.8" opacity="0.75" />
      <path d="M15.5 14.3c2.5.4 4.5 2.6 4.5 5.7" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
    </svg>
  ),
  retail_banking: ({ color }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M3 10 12 4l9 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 10v9h16v-9M9 19v-6M15 19v-6" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  legal_risk: ({ color }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v18M7 7l-4 8a4 4 0 0 0 8 0l-4-8ZM17 7l-4 8a4 4 0 0 0 8 0l-4-8ZM5 7h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  technology: ({ color }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <rect x="8" y="8" width="8" height="8" rx="1.2" stroke={color} strokeWidth="1.8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

function DeptIcon({ id, color }: { id: string; color: string }) {
  const Icon = ICONS[id];
  if (!Icon) return <span className="h-2 w-2 rounded-full" style={{ background: color }} />;
  return <Icon color={color} />;
}

export function DepartmentSelect({
  departments,
  value,
  onChange,
}: {
  departments: Department[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = departments.find((d) => d.id === value);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] py-1.5 pl-2.5 pr-2 text-[12.5px] font-medium text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--brand)]/40 focus-visible:border-[var(--brand)]"
      >
        <span
          className="flex h-5 w-5 items-center justify-center rounded-md"
          style={{ background: current ? `color-mix(in srgb, ${departmentColor(current.id)} 16%, transparent)` : undefined }}
        >
          {current && <DeptIcon id={current.id} color={departmentColor(current.id)} />}
        </span>
        {current?.label ?? "Select…"}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="pop-in absolute right-0 top-[calc(100%+6px)] z-20 w-64 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] py-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.18)]">
          {departments.map((d) => {
            const color = departmentColor(d.id);
            const active = d.id === value;
            return (
              <button
                key={d.id}
                onClick={() => {
                  onChange(d.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors ${
                  active ? "bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]" : "hover:bg-[var(--surface-1)]"
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                  style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
                >
                  <DeptIcon id={d.id} color={color} />
                </span>
                <span className={`flex-1 ${active ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                  {d.label}
                </span>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="var(--brand)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

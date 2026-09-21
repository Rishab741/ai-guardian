"use client";

import { useState } from "react";

export type BarItem = {
  label: string;
  value: number;
  color: string;
  formatted?: string;
};

export function BarList({ items, unit }: { items: BarItem[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, i) => {
        const pct = (item.value / max) * 100;
        const isHover = hover === i;
        return (
          <div
            key={item.label}
            className="group"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] font-medium text-[var(--text-secondary)]">{item.label}</span>
              <span
                className="tabular shrink-0 text-[12px] font-semibold transition-opacity"
                style={{ color: isHover ? item.color : "var(--text-primary)" }}
              >
                {item.formatted ?? item.value}
                {unit}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--gridline)]">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${Math.max(pct, 2)}%`,
                  background: item.color,
                  opacity: isHover || hover === null ? 1 : 0.45,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

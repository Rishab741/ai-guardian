"use client";

import { useRef, useState } from "react";

export type Series = { key: string; label: string; color: string };

export function TrendChart({
  data,
  series,
  xKey,
  formatValue = (v: number) => v.toFixed(2),
  formatX = (v: string) => v.slice(5),
}: {
  data: Record<string, string | number>[];
  series: Series[];
  xKey: string;
  formatValue?: (v: number) => string;
  formatX?: (v: string) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 640;
  const H = 220;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allValues = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
  const maxVal = Math.max(1, ...allValues) * 1.15;

  const xFor = (i: number) => padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yFor = (v: number) => padT + plotH - (v / maxVal) * plotH;

  function pathFor(key: string) {
    return data.map((d, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(Number(d[key]) || 0)}`).join(" ");
  }

  function areaFor(key: string) {
    const line = data.map((d, i) => `${xFor(i)},${yFor(Number(d[key]) || 0)}`).join(" L");
    return `M${xFor(0)},${yFor(0)} L${line} L${xFor(data.length - 1)},${yFor(0)} Z`;
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!ref.current || data.length === 0) return;
    const rect = ref.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((relX - padL) / plotW) * (data.length - 1));
    setHoverIdx(Math.min(Math.max(idx, 0), data.length - 1));
  }

  const gridLines = 4;
  const tickEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = padT + (plotH / gridLines) * i;
          const val = maxVal - (maxVal / gridLines) * i;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--gridline)" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">
                {val >= 1 ? val.toFixed(0) : val.toFixed(2)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) =>
          i % tickEvery === 0 ? (
            <text key={i} x={xFor(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {formatX(String(d[xKey]))}
            </text>
          ) : null
        )}

        {series.map((s, si) => (
          <path key={s.key} d={areaFor(s.key)} fill={s.color} opacity={si === 0 ? 0.12 : 0.06} stroke="none" />
        ))}
        {series.map((s) => (
          <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {hoverIdx !== null && (
          <line
            x1={xFor(hoverIdx)}
            x2={xFor(hoverIdx)}
            y1={padT}
            y2={padT + plotH}
            stroke="var(--baseline)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {hoverIdx !== null &&
          series.map((s) => (
            <circle
              key={s.key}
              cx={xFor(hoverIdx)}
              cy={yFor(Number(data[hoverIdx][s.key]) || 0)}
              r={3.5}
              fill={s.color}
              stroke="var(--surface-raised)"
              strokeWidth={1.5}
            />
          ))}
      </svg>

      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[11px] shadow-sm"
          style={{
            left: `${Math.min(Math.max((xFor(hoverIdx) / W) * 100, 14), 82)}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="mb-1 font-medium text-[var(--text-primary)]">{String(data[hoverIdx][xKey])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              <span className="text-[var(--text-secondary)]">{s.label}:</span>
              <span className="tabular font-semibold text-[var(--text-primary)]">
                {formatValue(Number(data[hoverIdx][s.key]) || 0)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-4">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

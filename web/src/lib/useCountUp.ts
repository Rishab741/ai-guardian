"use client";

import { useEffect, useRef, useState } from "react";

/** Animates a displayed number toward `target` whenever it changes. Skips
 * the animation entirely on the very first paint (no data -> 0 -> value
 * flicker) by snapping straight to the initial value. */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const first = useRef(true);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      setValue(target);
      return;
    }
    const from = value;
    const delta = target - from;
    if (delta === 0) return;
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + delta * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}

"use client";

import { useEffect, useState } from "react";
import { BASE_URL } from "./api";
import { bearer } from "./auth";
import type { FeedEvent } from "./types";

/**
 * Subscribes to the gateway's live audit stream. Uses fetch streaming rather
 * than EventSource so the session token travels in a header, never a URL.
 * Reconnects with a growing back-off if the connection drops (for example a
 * free host waking from sleep).
 */
export function useLiveFeed(max = 40): { events: FeedEvent[]; connected: boolean } {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;

    async function run() {
      let backoff = 1000;
      while (!stopped) {
        try {
          const token = await bearer();
          const res = await fetch(`${BASE_URL}/api/events/stream`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(String(res.status));
          setConnected(true);
          backoff = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let idx;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const data = frame.split("\n").find((l) => l.startsWith("data: "));
              if (!data) continue;
              try {
                const event = JSON.parse(data.slice(6)) as FeedEvent;
                setEvents((prev) => [event, ...prev].slice(0, max));
              } catch {
                // ignore a malformed frame; the next one is independent
              }
            }
          }
        } catch {
          if (stopped) return;
        }
        setConnected(false);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15000);
      }
    }
    run();
    return () => {
      stopped = true;
      ctrl.abort();
    };
  }, [max]);

  return { events, connected };
}

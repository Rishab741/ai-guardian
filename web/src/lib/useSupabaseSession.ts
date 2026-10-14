"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** Demo mode (no Supabase env vars configured) resolves immediately with a
 * null session — every consumer of this hook already treats "no session" as
 * "not gated," so this degrades safely without special-casing demo mode. */
export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let supabase;
    try {
      supabase = createClient();
    } catch {
      setLoaded(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoaded(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loaded };
}

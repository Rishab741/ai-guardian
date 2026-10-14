import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Throws if the env vars aren't set — callers
 * in code paths that must also work in demo mode (no Supabase project
 * required) should wrap this in try/catch. */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase env vars not configured (expected in demo mode).");
  }
  return createBrowserClient(url, anonKey);
}

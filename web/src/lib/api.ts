import type {
  AuditLog,
  ChatResponse,
  Department,
  DepartmentBreakdown,
  DiscoveryReport,
  DailyPoint,
  PiiTypeBreakdown,
  Profile,
  RoiPreset,
  RoiProjection,
  SummaryStats,
} from "./types";
import { createClient } from "./supabase/client";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Returns an Authorization header when a Supabase session exists; empty
 * object in demo mode (no Supabase project configured) or when signed out.
 * The backend ignores this header entirely while DEMO_MODE=true. */
async function authHeader(): Promise<Record<string, string>> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...auth, ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; demo_mode: boolean; cache_size: number }>("/api/health"),
  departments: () => request<Department[]>("/api/departments"),
  me: async () => {
    try {
      return await request<Profile | null>("/api/me");
    } catch {
      return null; // 401 (not signed in) or backend unreachable — treat as "no profile"
    }
  },
  chat: (message: string, department: string, userLabel: string) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, department, user_label: userLabel }),
    }),
  summary: () => request<SummaryStats>("/api/stats/summary"),
  departmentBreakdown: () => request<DepartmentBreakdown[]>("/api/stats/departments"),
  piiTypeBreakdown: () => request<PiiTypeBreakdown[]>("/api/stats/pii-types"),
  timeseries: (days = 14) => request<DailyPoint[]>(`/api/stats/timeseries?days=${days}`),
  auditLogs: (limit = 50) => request<AuditLog[]>(`/api/audit-logs?limit=${limit}`),
  discoveryReport: () => request<DiscoveryReport>("/api/discovery-report"),
  resetDemo: () => request<{ cache_entries_cleared: number }>("/api/demo/reset", { method: "POST" }),
  roiPresets: () => request<Record<string, RoiPreset>>("/api/roi-presets"),
  roiProjection: (employees: number, queriesPerDay: number, breachCostUsd?: number) =>
    request<RoiProjection>(
      `/api/roi-projection?employees=${employees}&queries_per_day=${queriesPerDay}${
        breachCostUsd ? `&breach_cost_usd=${breachCostUsd}` : ""
      }`
    ),
};

import type {
  AuditLog,
  AuthConfig,
  ChatResponse,
  Department,
  DepartmentBreakdown,
  DiscoveryReport,
  DailyPoint,
  Health,
  Me,
  PiiTypeBreakdown,
  RiskyUser,
  RoiPreset,
  RoiProjection,
  SummaryStats,
} from "./types";
import { bearer, signOut } from "./auth";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await bearer();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.detail ?? body.error?.message ?? message;
    } catch {}
    if (res.status === 401 && token) {
      // Session expired or revoked: drop it and send the user to sign in.
      await signOut();
      window.dispatchEvent(new Event("sf:signed-out"));
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/api/health"),
  authConfig: () => request<AuthConfig>("/api/auth/config"),
  demoLogin: (personaId: string, accessCode?: string) =>
    request<{ token: string }>("/api/auth/demo-login", {
      method: "POST",
      body: JSON.stringify({ persona_id: personaId, access_code: accessCode || null }),
    }),
  me: () => request<Me>("/api/auth/me"),
  departments: () => request<Department[]>("/api/departments"),
  chat: (message: string, department: string) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, department }),
    }),
  summary: () => request<SummaryStats>("/api/stats/summary"),
  departmentBreakdown: () => request<DepartmentBreakdown[]>("/api/stats/departments"),
  piiTypeBreakdown: () => request<PiiTypeBreakdown[]>("/api/stats/pii-types"),
  timeseries: (days = 14) => request<DailyPoint[]>(`/api/stats/timeseries?days=${days}`),
  riskyUsers: (windowDays = 30, limit = 8) =>
    request<RiskyUser[]>(`/api/stats/risky-users?window_days=${windowDays}&limit=${limit}`),
  auditLogs: (limit = 50) => request<AuditLog[]>(`/api/audit-logs?limit=${limit}`),
  verifyAudit: () => request<{ ok: boolean; checked: number; first_bad_id: number | null }>("/api/audit/verify"),
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

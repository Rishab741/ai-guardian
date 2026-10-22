import type {
  AppInfo,
  AppStat,
  AuditLog,
  EvidencePack,
  ImpactResult,
  PersonProfile,
  PolicyDoc,
  PolicyPack,
  PolicyVersion,
  PromptSimulation,
  TenantSettings,
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

// Empty on Vercel: requests go to this site's own /api and /v1, which
// next.config.ts forwards to the gateway (same origin, no CORS).
export const BASE_URL =
  process.env.NEXT_PUBLIC_API_PROXY === "1" ? "" : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000");

/** The gateway address as an app developer would type it. */
export function publicGatewayUrl(): string {
  return BASE_URL || (typeof window === "undefined" ? "" : window.location.origin);
}

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
  apps: (windowDays = 30) => request<AppStat[]>(`/api/stats/apps?window_days=${windowDays}`),
  person: (ref: string, days = 30) => request<PersonProfile>(`/api/people/${encodeURIComponent(ref)}?days=${days}`),
  policies: () => request<PolicyVersion[]>("/api/policies"),
  policyPacks: () => request<Record<string, PolicyPack>>("/api/policies/packs"),
  proposePolicy: (doc: PolicyDoc, note: string) =>
    request<{ version: number }>("/api/policies", { method: "POST", body: JSON.stringify({ doc, note }) }),
  decidePolicy: (version: number, approve: boolean, note: string) =>
    request<{ status: string }>(`/api/policies/${version}/${approve ? "approve" : "reject"}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  simulatePrompt: (doc: PolicyDoc, department: string, prompt: string) =>
    request<PromptSimulation>("/api/policies/simulate/prompt", {
      method: "POST",
      body: JSON.stringify({ doc, department, prompt }),
    }),
  simulateImpact: (doc: PolicyDoc, days = 7) =>
    request<ImpactResult>("/api/policies/simulate/impact", { method: "POST", body: JSON.stringify({ doc, days }) }),
  settings: () => request<TenantSettings>("/api/settings"),
  saveSettings: (patch: Partial<TenantSettings>) =>
    request<TenantSettings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  addDepartment: (id: string, label: string) =>
    request<{ id: string; label: string; note: string }>("/api/departments", {
      method: "POST",
      body: JSON.stringify({ id, label }),
    }),
  listApps: () => request<AppInfo[]>("/api/apps"),
  createApp: (name: string, defaultDepartment: string, description = "") =>
    request<{ id: string; name: string; api_key: string; note: string }>("/api/apps", {
      method: "POST",
      body: JSON.stringify({ name, default_department: defaultDepartment, description }),
    }),
  rotateKey: (appId: string) => request<{ api_key: string }>(`/api/apps/${appId}/rotate-key`, { method: "POST" }),
  warmup: () =>
    request<{ ok: boolean; checks: { name: string; ok: boolean; ms: number; detail: string }[] }>("/api/demo/warmup", {
      method: "POST",
    }),
  scenarios: () => request<Record<string, string>>("/api/demo/scenarios"),
  tick: (count = 1, scenario?: string) =>
    request<{ audit_ids: number[] }>("/api/demo/tick", { method: "POST", body: JSON.stringify({ count, scenario }) }),
  evidence: (days = 30) => request<EvidencePack>(`/api/reports/evidence?days=${days}`),
  roiPresets: () => request<Record<string, RoiPreset>>("/api/roi-presets"),
  roiProjection: (employees: number, queriesPerDay: number, breachCostUsd?: number) =>
    request<RoiProjection>(
      `/api/roi-projection?employees=${employees}&queries_per_day=${queriesPerDay}${
        breachCostUsd ? `&breach_cost_usd=${breachCostUsd}` : ""
      }`
    ),
};

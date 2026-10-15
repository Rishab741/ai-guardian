export type Department = {
  id: string;
  label: string;
};

export type Role = "platform_admin" | "executive" | "ciso" | "compliance" | "tenant_admin" | "developer";

export type Me = {
  id: string;
  email: string;
  display_name: string;
  title: string;
  role: Role;
  role_label: string;
  persona: boolean;
  permissions: string[];
  sees_identities: boolean;
};

export type Persona = {
  id: string;
  email: string;
  display_name: string;
  title: string;
  role: Role;
  role_label: string;
};

export type AuthConfig = {
  demo_mode: boolean;
  access_code_required: boolean;
  personas: Persona[];
  firebase: { apiKey: string; authDomain: string; projectId: string } | null;
};

export type Health = {
  status: string;
  demo_mode: boolean;
  environment: string;
  llm_provider: "gemini" | "simulated";
};

export type RiskyUser = {
  user_id: string;
  display_name: string | null;
  title: string | null;
  department_label: string;
  requests: number;
  blocked: number;
  pii_exposures: number;
  injection_flags: number;
  last_seen: string;
  risk_score: number;
};

export type PipelineStep = {
  step: string;
  label: string;
  status: "ok" | "blocked" | "hit" | "miss" | "skipped" | "warn";
  detail: string;
};

export type RedactionOut = {
  pii_type: string;
  token: string;
};

export type ChatResponse = {
  audit_id: number;
  allowed: boolean;
  response: string;
  department_label: string;
  cache_hit: boolean;
  model_used: string | null;
  model_label: string | null;
  tier: string | null;
  cost_usd: number;
  latency_ms: number;
  redactions: RedactionOut[];
  pipeline: PipelineStep[];
  prompt_redacted?: string | null;
  response_redacted?: string | null;
};

export type SummaryStats = {
  total_requests: number;
  cache_hits: number;
  total_pii_redactions: number;
  total_cost: number;
  total_cost_if_no_cache: number;
  blocked_requests: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
  savings_usd: number;
  savings_pct: number;
};

export type DepartmentBreakdown = {
  department: string;
  department_label: string;
  requests: number;
  pii_redactions: number;
  cache_hits: number;
  cost_usd: number;
  blocked_requests: number;
};

export type PiiTypeBreakdown = {
  pii_type: string;
  count: number;
};

export type DailyPoint = {
  day: string;
  requests: number;
  pii_redactions: number;
  cache_hits: number;
  cost_usd: number;
  cost_if_no_cache: number;
};

export type AuditLog = {
  id: number;
  ts: string;
  source: "gateway" | "console" | "simulator" | "seed";
  department: string;
  department_label: string;
  app_name: string | null;
  end_user_id: string | null;
  user_label: string;
  user_title: string | null;
  decision: "allowed" | "blocked" | "error";
  flags: string[];
  prompt_redacted: string;
  response_redacted: string | null;
  cache_hit: boolean;
  model_used: string | null;
  model_label: string | null;
  tier: string | null;
  cost_usd: number;
  latency_ms: number;
  policy_allowed: boolean;
  policy_reason: string | null;
  pii_types: string[];
  pii_count: number;
};

export type Finding = {
  severity: "high" | "medium";
  title: string;
  detail: string;
};

export type RoiPreset = {
  label: string;
  employees: number;
  queries_per_day: number;
};

export type RoiProjection = {
  inputs: {
    employees: number;
    queries_per_day: number;
    window_days: number;
    breach_cost_usd: number;
  };
  observed: {
    pilot_requests: number;
    pilot_pii_exposures: number;
    avg_savings_per_request_usd: number;
  };
  enterprise_daily_requests: number;
  enterprise_annual_requests: number;
  finops_annual_savings_usd: number;
  risk_avoided_usd: number;
  risk_avoided_source: string;
  total_annual_value_usd: number;
};

export type DiscoveryReport = {
  summary: SummaryStats;
  department_breakdown: DepartmentBreakdown[];
  pii_type_breakdown: PiiTypeBreakdown[];
  findings: Finding[];
  observed_days: number;
  projected_annual_savings_usd: number;
};

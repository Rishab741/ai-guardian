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

export type FeedEvent = {
  id: number;
  ts: string;
  source: "gateway" | "console" | "simulator" | "seed";
  app_name: string | null;
  end_user_id: string | null;
  user_label: string;
  department: string;
  department_label: string;
  decision: "allowed" | "blocked" | "error";
  pii_types: string[];
  cache_hit: boolean;
  tier: string | null;
  flags: string[];
};

export type AppStat = {
  app_name: string;
  requests: number;
  users: number;
  blocked: number;
  pii_exposures: number;
  cache_hits: number;
  last_seen: string;
};

export type PersonProfile = {
  user: { id: string; display_name: string; title: string; department: string; department_label: string };
  totals: { requests: number; blocked: number; pii_exposures: number; injection_flags: number; apps: number };
  daily: { day: string; requests: number; blocked: number; pii: number }[];
  data_classes: { pii_type: string; count: number }[];
  events: AuditLog[];
  identity_visible: boolean;
};

export type DataAction = "allow" | "redact" | "block";
export type DeptRules = {
  data_classes: Record<string, DataAction>;
  rehydrate?: Record<string, boolean>;
  max_tier?: "fast" | "balanced" | "deep";
  rate_limit_per_user_per_min?: number;
};
export type PolicyDoc = {
  departments: Record<string, DeptRules>;
  global: { deny_terms: string[]; prompt_injection: "off" | "flag" | "block"; rehydrate: Record<string, boolean> };
};
export type PolicyVersion = {
  version: number;
  status: "draft" | "pending_approval" | "active" | "superseded" | "rejected";
  note: string;
  decision_note: string | null;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  doc: PolicyDoc;
};
export type PolicyPack = { label: string; summary: string; doc: PolicyDoc };
export type ImpactResult = {
  window_days: number;
  replayed: number;
  newly_blocked: number;
  newly_allowed: number;
  blocked_before: number;
  blocked_after: number;
  by_department: { department: string; department_label: string; requests: number; newly_blocked: number; newly_allowed: number }[];
  note: string;
};
type SimOutcome = { allowed: boolean; reason: string | null; flags: string[]; sent_to_model: string | null; max_tier: string };
export type PromptSimulation = { data_classes: string[]; active: SimOutcome; proposed: SimOutcome };

export type TenantSettings = {
  name: string;
  privacy_mode?: "named" | "pseudonymous";
  employee_notice?: string;
  sso?: { provider: string; domain: string; status: string };
  onboarding?: { completed: string[] };
};

export type AppInfo = {
  id: string;
  name: string;
  description: string;
  default_department: string;
  disabled: boolean;
  created_at: string;
  key_prefix: string | null;
  last_used_at: string | null;
};

export type EvidencePack = {
  tenant: string;
  generated_at: string;
  period: { from: string; to: string; days: number };
  summary: SummaryStats & { identity_coverage: number; active_users: number };
  cps234: {
    classification: { data_class: string; label: string; occurrences: number }[];
    access_control: { display_name: string; title: string; role: string; last_login_at: string | null }[];
    identity_coverage: { verified_requests: number; total_requests: number };
    detection: { blocked_requests: number; prompt_injection_flags: number; riskiest_users: RiskyUser[] };
    audit_integrity: { ok: boolean; checked: number; first_bad_id: number | null };
    change_management: {
      policy_versions: Omit<PolicyVersion, "doc" | "decision_note">[];
      console_actions: { ts: string; actor: string; actor_role: string; action: string; target: string }[];
    };
  };
  cps230: {
    service_providers: { provider: string; model_used: string; calls: number; errors: number; share: number; p50_ms: number; p95_ms: number }[];
    resilience: { requests_rerouted: number; served_by_offline_fallback: number; cache_hit_rate: number };
  };
};

export type ComplianceOutcome = {
  department: string;
  department_label: string;
  allowed: boolean;
  reason: string | null;
  actions: Record<string, DataAction>;
  flags: string[];
  max_tier: string;
  sent_to_model: string | null;
};
export type ComplianceResult = {
  policy_version: number;
  detections: { pii_type: string; label: string; start: number; end: number }[];
  outcomes: ComplianceOutcome[];
};
export type StaffMember = { id: string; display_name: string; title: string; department: string; department_label: string };

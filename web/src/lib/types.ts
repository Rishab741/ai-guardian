export type Department = {
  id: string;
  label: string;
};

export type Profile = {
  id: string;
  email: string;
  department: string | null;
  role: "member" | "admin";
};

export type PipelineStep = {
  step: string;
  label: string;
  status: "ok" | "blocked" | "hit" | "miss";
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
  department: string;
  department_label: string;
  user_label: string;
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

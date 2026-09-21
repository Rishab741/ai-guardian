export type DeptPrompt = { text: string; hint: string };

// Curated per-department prompts: each set is real-world flavored for that
// business function and deliberately mixes allowed and policy-blocked
// scenarios, so switching departments changes not just the words shown but
// the actual outcomes a viewer will see when they click one.
export const DEPARTMENT_PROMPTS: Record<string, DeptPrompt[]> = {
  finance: [
    { text: "Analyze the risk exposure for our SME lending portfolio this quarter", hint: "Deep-tier analysis" },
    { text: "Please analyze this customer record for TFN 123 456 782 and email jane.smith@customerbank.com.au", hint: "TFN + email redaction" },
    { text: "Reconcile the Medicare provider number 2123 45670 1 against our claims record", hint: "Policy boundary" },
    { text: "Forecast Q4 revenue variance against budget", hint: "Routine, fast tier" },
  ],
  hr: [
    { text: "Draft a policy explainer on Privacy Act obligations for new hires", hint: "Routine, fast tier" },
    { text: "Summarize this candidate's interview notes involving Mr John Nguyen", hint: "Name redaction" },
    { text: "Verify this reimbursement card number 4111 1111 1111 1111 for the expense claim", hint: "Policy boundary" },
    { text: "Forecast staffing needs for the contact centre next quarter", hint: "Deep-tier analysis" },
  ],
  retail_banking: [
    { text: "Draft a response to the customer complaint regarding account 4111 1111 1111 1111", hint: "Card redaction" },
    { text: "Call this customer back on 0412 345 678 to confirm their new address", hint: "Phone redaction" },
    { text: "Reconcile the Medicare provider number 2123 45670 1 against our claims record", hint: "Policy boundary" },
    { text: "Analyze churn trends across our retail banking segment", hint: "Deep-tier analysis" },
  ],
  legal_risk: [
    { text: "Audit this vendor engagement for ABN 51 824 753 556, contact Mr John Nguyen, for compliance review", hint: "Multi-field redaction" },
    { text: "Summarize APRA CPS 230 operational resilience obligations for our board pack", hint: "Routine, fast tier" },
    { text: "Explain why the audit flagged ABN 51 824 753 556 for review", hint: "ABN redaction" },
    { text: "Compare this year's compliance incident count to last year", hint: "Always unrestricted" },
  ],
  technology: [
    { text: "Send this customer's card number 4111 1111 1111 1111 to the vendor model for fraud scoring", hint: "Policy boundary" },
    { text: "What is the TFN validation rule we use for onboarding? Example: 123 456 782", hint: "Policy boundary" },
    { text: "Compare vendor pricing for our new CRM rollout", hint: "Deep-tier analysis" },
    { text: "Draft an internal FAQ about our new expense claim process", hint: "Routine, fast tier" },
  ],
};

export const DEFAULT_DEPARTMENT_PROMPTS: DeptPrompt[] = DEPARTMENT_PROMPTS.retail_banking;

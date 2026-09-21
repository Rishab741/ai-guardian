export type ScriptStep = {
  id: string;
  department: string;
  prompt: string;
  talkingPoint: string;
};

export const CHAT_SCRIPT: ScriptStep[] = [
  {
    id: "routine",
    department: "retail_banking",
    prompt: "What's a good subject line for our monthly customer newsletter?",
    talkingPoint:
      "Start simple — an everyday, low-risk query with no sensitive data. It goes straight to the fast, cheap model tier.",
  },
  {
    id: "pii",
    department: "finance",
    prompt: "Please analyze this customer record for TFN 123 456 782 and email jane.smith@customerbank.com.au",
    talkingPoint:
      "Now watch closely — this contains a real Tax File Number and an email address. The gateway detects and tokenizes both before the prompt ever leaves the building.",
  },
  {
    id: "cache",
    department: "finance",
    prompt: "Please analyze this customer record for TFN 123 456 782 and email jane.smith@customerbank.com.au",
    talkingPoint:
      "Same question again. Instead of paying for another model call, the semantic cache recognizes it's equivalent to the last one — instant answer, zero cost.",
  },
  {
    id: "medicare-blocked",
    department: "finance",
    prompt: "Reconcile the Medicare provider number 2123 45670 1 against our claims record",
    talkingPoint:
      "Different department, different rule: Finance can handle financial identifiers, but health data is out of scope entirely — blocked before it ever reaches a model.",
  },
  {
    id: "card-blocked",
    department: "technology",
    prompt: "Send this customer's card number 4111 1111 1111 1111 to the vendor model for fraud scoring",
    talkingPoint:
      "This is the moment that matters for a CISO: Technology isn't entitled to route card data externally at all. The policy engine blocks it outright and logs the attempt.",
  },
  {
    id: "hr-blocked",
    department: "hr",
    prompt: "Verify this reimbursement card number 4111 1111 1111 1111 for the expense claim",
    talkingPoint:
      "Same rule, different department, different reason: HR doesn't need to touch payment card data at all — every department gets its own entitlement boundary, not a blanket policy.",
  },
  {
    id: "compliance",
    department: "legal_risk",
    prompt: "Audit this vendor engagement for ABN 51 824 753 556, contact Mr John Nguyen, for compliance review",
    talkingPoint:
      "And Legal & Risk / Compliance is deliberately unrestricted — its entire job is oversight, so it needs full visibility. Two more PII types get tokenized here: the ABN and the contact's name, both flagged as 'audit'-complexity so it's routed to the deep-reasoning tier.",
  },
];

export const DASHBOARD_TALKING_POINT =
  "Everything we just did in the console is already reflected here, live. This is the executive view: cost savings, blocked violations, and PII exposure trends, updating in real time as the business uses the tool.";

export const DISCOVERY_TALKING_POINT =
  "And this is the sales wedge: after just a 14-day passive pilot, the CISO gets an automatic dossier of every unmonitored exposure the organization didn't know it had — plus the projected savings case for rolling the gateway out fully.";

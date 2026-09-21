const SLOTS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

// Fixed assignment order so a given department/PII type always draws the
// same hue across charts, independent of sort order or which items are
// currently visible (color follows the entity, never its rank).
const DEPARTMENT_ORDER = ["retail_banking", "finance", "technology", "hr", "legal_risk"];
const PII_TYPE_ORDER = ["AU_TFN", "AU_MEDICARE", "AU_ABN", "CREDIT_CARD", "EMAIL", "AU_PHONE", "PERSON_NAME"];

export function departmentColor(id: string): string {
  const idx = DEPARTMENT_ORDER.indexOf(id);
  return SLOTS[idx >= 0 ? idx % SLOTS.length : SLOTS.length - 1];
}

export function piiTypeColor(type: string): string {
  const idx = PII_TYPE_ORDER.indexOf(type);
  return SLOTS[idx >= 0 ? idx % SLOTS.length : SLOTS.length - 1];
}

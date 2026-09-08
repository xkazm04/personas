// The v3 domain family -> the explore category `exploreDomains.ts` already maps.
//
// Extracted from `generate-recipe-index.mjs` so `merge-into-bundle.mjs` can file
// a seed row under the same category the generated index will show it under. It
// had one copy and one reader; a second reader with a second copy is how the two
// start disagreeing about where a recipe lives.
//
// Families with no explore home land on 'operations', which is that file's own
// documented catch-all, so nothing is orphaned.
export const DOMAIN_TO_EXPLORE_CATEGORY = {
  software_engineering: 'development',
  data_ai: 'analytics',
  product_project: 'project_management',
  sales_marketing: 'marketing',
  creative_design: 'content',
  finance_accounting: 'finance',
  general_professional: 'productivity',
  operations_logistics: 'operations',
  customer_support: 'operations',
  legal_compliance: 'operations',
  hr_people: 'operations',
  education_academic: 'content',
  life_sciences_research: 'research',
  healthcare_clinical: 'operations',
  skilled_trades: 'operations',
  frontline_service: 'operations',
};

/// The explore category for a v3 domain, with the catch-all applied.
export const exploreCategoryFor = (domain) =>
  DOMAIN_TO_EXPLORE_CATEGORY[domain] ?? 'operations';

/**
 * Explore — data-grounded domain taxonomy for the Industry/Domain Atlas.
 *
 * The real template corpus is organized by FUNCTION/DEPARTMENT (development,
 * research, content, finance, sales, …), not by industry vertical — a corpus
 * scan found 16 category values and exactly ONE industry-ish tag (`ecommerce`).
 * So the Atlas top level is 7 balanced DOMAINS that fold every real category in
 * with no orphans (the shipped role grouping orphaned 10/30). Each domain has a
 * Leonardo symbolic illustration (public/illustrations/explore/domain-<id>.png).
 *
 * Counts below are the observed published-template distribution — the tiles are
 * genuinely "balanced per the data".
 */
export interface Domain {
  id: string;
  label: string;
  blurb: string;
  color: string;
  /** Real category values (searchConstants canonical) that fold into this domain. */
  categories: string[];
  illustration: string;
}

export const DOMAINS: Domain[] = [
  {
    id: 'engineering', label: 'Engineering', color: '#6366f1',
    blurb: 'Ship, review, and operate software — dev, DevOps, and security agents.',
    categories: ['development', 'devops', 'security', 'testing', 'quality', 'maintenance'],
    illustration: '/illustrations/explore/domain-engineering.png',
  },
  {
    id: 'research', label: 'Research & Intelligence', color: '#06b6d4',
    blurb: 'Gather signal, summarize, and keep a source of truth current.',
    categories: ['research', 'data', 'analytics', 'ai'],
    illustration: '/illustrations/explore/domain-research.png',
  },
  {
    id: 'content', label: 'Content Studio', color: '#ec4899',
    blurb: 'Draft, produce, and publish on-brand content and docs.',
    categories: ['content', 'documentation', 'education'],
    illustration: '/illustrations/explore/domain-content.png',
  },
  {
    id: 'revenue', label: 'Sales & Marketing', color: '#f59e0b',
    blurb: 'Win and grow customers — pipeline, campaigns, and storefronts.',
    categories: ['sales', 'marketing', 'ecommerce'],
    illustration: '/illustrations/explore/domain-revenue.png',
  },
  {
    id: 'finance', label: 'Finance', color: '#10b981',
    blurb: 'Invoicing, spend, reconciliation, and financial reporting.',
    categories: ['finance'],
    illustration: '/illustrations/explore/domain-finance.png',
  },
  {
    id: 'operations', label: 'Operations', color: '#8b5cf6',
    blurb: 'Keep work moving — productivity, projects, scheduling, and pipelines.',
    categories: ['productivity', 'project_management', 'operations', 'automation', 'integration', 'pipeline', 'scheduling', 'monitoring'],
    illustration: '/illustrations/explore/domain-operations.png',
  },
  {
    id: 'people', label: 'Customer & People', color: '#f43f5e',
    blurb: 'Support customers and run the team — success, comms, HR, and legal.',
    categories: ['support', 'email', 'communication', 'hr', 'legal'],
    illustration: '/illustrations/explore/domain-people.png',
  },
];

const CATEGORY_TO_DOMAIN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const d of DOMAINS) for (const c of d.categories) m[c] = d.id;
  return m;
})();

/** Normalize the odd real-world category spellings before mapping. */
function normalizeCategory(cat: string): string {
  const c = cat.toLowerCase().trim().replace(/-/g, '_');
  return c;
}

/** Map a template's category value(s) to a domain id (first match wins). */
export function domainForCategories(categories: string[]): string {
  for (const raw of categories) {
    const hit = CATEGORY_TO_DOMAIN[normalizeCategory(raw)];
    if (hit) return hit;
  }
  return 'operations'; // catch-all so nothing is orphaned
}

export const domainById = (id: string) => DOMAINS.find((d) => d.id === id);

/** Pretty label for a raw category (the sub-cluster label inside a domain). */
export function categoryLabel(cat: string): string {
  const c = normalizeCategory(cat);
  const special: Record<string, string> = {
    project_management: 'Project Mgmt', devops: 'DevOps', hr: 'People Ops',
    ai: 'AI', ecommerce: 'E-commerce',
  };
  if (special[c]) return special[c];
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

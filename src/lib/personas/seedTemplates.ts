/**
 * Seed Templates — converts catalog entries into PersonaDesignReview
 * records for the Generated tab. Each template is inserted once (idempotent).
 *
 * Source of truth: templateCatalog.ts (single template catalog).
 */
import { FEATURED_TEMPLATES, CATEGORY_TEMPLATES } from './templateCatalog';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';

const SEED_BUILTIN_RUN_ID = 'seed-builtin-v1';
const SEED_CATEGORY_RUN_ID = 'seed-category-v1';

export interface SeedReviewInput {
  test_case_id: string;
  test_case_name: string;
  instruction: string;
  status: string;
  structural_score: number | null;
  semantic_score: number | null;
  connectors_used: string | null;
  trigger_types: string | null;
  design_result: string | null;
  use_case_flows: string | null;
  test_run_id: string;
  reviewed_at: string;
  category: string | null;
}

function templateToReviewInput(template: TemplateCatalogEntry, runId: string): SeedReviewInput {
  const payload = template.payload as unknown as Record<string, unknown>;
  const connectors = Array.isArray(payload.suggested_connectors)
    ? (payload.suggested_connectors as Array<{ name: string }>).map((c) => c.name)
    : [];
  const triggers = Array.isArray(payload.suggested_triggers)
    ? (payload.suggested_triggers as Array<{ trigger_type: string }>).map((t) => t.trigger_type)
    : [];

  const flows = Array.isArray(payload.use_case_flows)
    ? payload.use_case_flows
    : null;

  return {
    test_case_id: template.id,
    test_case_name: template.name,
    instruction: template.description,
    status: 'passed',
    structural_score: 100,
    semantic_score: 100,
    connectors_used: JSON.stringify(connectors),
    trigger_types: JSON.stringify(triggers),
    design_result: JSON.stringify(payload),
    use_case_flows: flows ? JSON.stringify(flows) : null,
    test_run_id: runId,
    reviewed_at: new Date().toISOString(),
    category: template.category?.[0] ?? null,
  };
}

/** All seed templates that should be present in the Generated tab. */
export function getSeedReviews(): SeedReviewInput[] {
  return [
    ...FEATURED_TEMPLATES.map((t) => templateToReviewInput(t, SEED_BUILTIN_RUN_ID)),
    ...CATEGORY_TEMPLATES.map((t) => templateToReviewInput(t, SEED_CATEGORY_RUN_ID)),
  ];
}

export { SEED_BUILTIN_RUN_ID, SEED_CATEGORY_RUN_ID };

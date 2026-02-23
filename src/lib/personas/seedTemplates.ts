/**
 * Seed Templates — converts BUILTIN_TEMPLATES into PersonaDesignReview
 * records for the Generated tab. Each template is inserted once (idempotent).
 *
 * Source of truth: builtinTemplates.ts (curated template set).
 */
import { BUILTIN_TEMPLATES } from './builtinTemplates';
import { CATEGORY_TEMPLATES } from './categoryTemplates';
import type { BuiltinTemplate } from '@/lib/types/templateTypes';

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
}

function templateToReviewInput(template: BuiltinTemplate, runId: string): SeedReviewInput {
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
  };
}

/** All seed templates that should be present in the Generated tab. */
export function getSeedReviews(): SeedReviewInput[] {
  return [
    ...BUILTIN_TEMPLATES.map((t) => templateToReviewInput(t, SEED_BUILTIN_RUN_ID)),
    ...CATEGORY_TEMPLATES.map((t) => templateToReviewInput(t, SEED_CATEGORY_RUN_ID)),
  ];
}

export { SEED_BUILTIN_RUN_ID, SEED_CATEGORY_RUN_ID };

/**
 * Seed Templates — converts built-in template JSON files into PersonaDesignReview
 * records for the Generated tab. Each template is inserted once (idempotent).
 */
import gmailMaestroTemplate from '../../../scripts/templates/google-workspace/gmail-maestro.json';

const SEED_RUN_ID = 'seed-builtin-v1';

interface TemplateSource {
  id: string;
  name: string;
  description: string;
  payload: {
    suggested_connectors?: Array<{ name: string }>;
    suggested_triggers?: Array<{ trigger_type: string }>;
    [key: string]: unknown;
  };
}

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
  test_run_id: string;
  reviewed_at: string;
}

function templateToReviewInput(template: TemplateSource): SeedReviewInput {
  const connectors = template.payload.suggested_connectors?.map((c) => c.name) ?? [];
  const triggers = template.payload.suggested_triggers?.map((t) => t.trigger_type) ?? [];

  return {
    test_case_id: template.id,
    test_case_name: template.name,
    instruction: template.description,
    status: 'passed',
    structural_score: 100,
    semantic_score: 100,
    connectors_used: JSON.stringify(connectors),
    trigger_types: JSON.stringify(triggers),
    design_result: JSON.stringify(template.payload),
    test_run_id: SEED_RUN_ID,
    reviewed_at: new Date().toISOString(),
  };
}

/** All seed templates that should be present in the Generated tab. */
export function getSeedReviews(): SeedReviewInput[] {
  const templates: TemplateSource[] = [
    gmailMaestroTemplate as TemplateSource,
  ];

  return templates.map(templateToReviewInput);
}

export { SEED_RUN_ID };

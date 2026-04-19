/**
 * Seed Templates -- converts catalog entries into PersonaDesignReview
 * records for the Generated tab. Each template is inserted once (idempotent).
 *
 * Source of truth: templateCatalog.ts (single template catalog).
 */
import { getTemplateCatalog } from './templateCatalog';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';

const SEED_RUN_ID = 'seed-category-v1';

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

  // v3 templates nest these inside persona / use_cases[]; fall back to the
  // flat v2 arrays when the v3 block isn't present.
  const personaObj = (payload.persona && typeof payload.persona === 'object')
    ? (payload.persona as Record<string, unknown>)
    : null;
  const useCases = Array.isArray(payload.use_cases)
    ? (payload.use_cases as Array<Record<string, unknown>>)
    : [];

  const v3Connectors = personaObj && Array.isArray(personaObj.connectors)
    ? (personaObj.connectors as Array<{ name?: string }>)
        .map((c) => c?.name ?? '')
        .filter(Boolean)
    : [];
  const v3Triggers = useCases
    .map((uc) => {
      const trig = uc.suggested_trigger as { trigger_type?: string } | undefined;
      return trig?.trigger_type ?? '';
    })
    .filter(Boolean);

  const legacyConnectors = Array.isArray(payload.suggested_connectors)
    ? (payload.suggested_connectors as Array<{ name: string }>).map((c) => c.name)
    : [];
  const legacyTriggers = Array.isArray(payload.suggested_triggers)
    ? (payload.suggested_triggers as Array<{ trigger_type: string }>).map((t) => t.trigger_type)
    : [];

  const connectors = v3Connectors.length > 0 ? v3Connectors : legacyConnectors;
  const triggers = v3Triggers.length > 0 ? v3Triggers : legacyTriggers;

  const v3Flows = useCases
    .map((uc) => {
      const flow = uc.use_case_flow as { nodes?: unknown; edges?: unknown } | undefined;
      if (!flow || typeof flow !== 'object') return null;
      return {
        id: uc.id ?? null,
        name: uc.title ?? uc.name ?? null,
        description: uc.description ?? null,
        capability_summary: uc.capability_summary ?? null,
        nodes: flow.nodes ?? [],
        edges: flow.edges ?? [],
      };
    })
    .filter(Boolean);

  const legacyFlows = Array.isArray(payload.use_case_flows)
    ? payload.use_case_flows
    : null;

  const flows = v3Flows.length > 0 ? v3Flows : legacyFlows;

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
export async function getSeedReviews(): Promise<SeedReviewInput[]> {
  const catalog = await getTemplateCatalog();
  return catalog.map((t) => templateToReviewInput(t, SEED_RUN_ID));
}

/** IDs of all templates currently in the catalog (used to prune stale seeds). */
export async function getActiveSeedIds(): Promise<string[]> {
  const catalog = await getTemplateCatalog();
  return catalog.map((t) => t.id);
}

export { SEED_RUN_ID };

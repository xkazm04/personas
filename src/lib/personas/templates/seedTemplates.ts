/**
 * Seed Templates -- converts catalog entries into PersonaDesignReview
 * records for the Generated tab. Each template is inserted once (idempotent).
 *
 * Source of truth: templateCatalog.ts (single template catalog).
 */
import { getTemplateCatalog } from './templateCatalog';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { batchImportDesignReviews, deleteStaleSeedTemplates } from '@/api/overview/reviews';

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
  const payload = template.payload;

  // v3 templates nest these inside persona / use_cases[]; fall back to the
  // flat v2 arrays when the v3 block isn't present.
  const personaObj = payload.persona ?? null;
  const useCases = payload.use_cases ?? [];

  const v3Connectors = personaObj?.connectors
    ? personaObj.connectors.map((c) => c?.name ?? '').filter(Boolean)
    : [];
  const v3Triggers = useCases
    .map((uc) => uc.suggested_trigger?.trigger_type ?? '')
    .filter(Boolean);

  const legacyConnectors = payload.suggested_connectors?.map((c) => c.name) ?? [];
  const legacyTriggers = payload.suggested_triggers?.map((t) => t.trigger_type) ?? [];

  const connectors = v3Connectors.length > 0 ? v3Connectors : legacyConnectors;
  const triggers = v3Triggers.length > 0 ? v3Triggers : legacyTriggers;

  const v3Flows = useCases
    .map((uc) => {
      const flow = uc.use_case_flow;
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

  const legacyFlows = payload.use_case_flows ?? null;

  const flows = v3Flows.length > 0 ? v3Flows : legacyFlows;

  // Tag unpublished drafts so the gallery's "Drafts" filter can isolate them.
  // Additive marker on the seeded design_result (adoption ignores unknown keys);
  // drafts only ever reach here in dev builds (the catalog skips them in prod).
  const designResultObj: Record<string, unknown> =
    template.is_published === false
      ? { ...(payload as Record<string, unknown>), _draft: true }
      : (payload as Record<string, unknown>);

  return {
    test_case_id: template.id,
    test_case_name: template.name,
    instruction: template.description,
    status: 'passed',
    structural_score: 100,
    semantic_score: 100,
    connectors_used: JSON.stringify(connectors),
    trigger_types: JSON.stringify(triggers),
    design_result: JSON.stringify(designResultObj),
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

// ---------------------------------------------------------------------------
// Session-scoped seed runner
// ---------------------------------------------------------------------------

let _seedOncePromise: Promise<void> | null = null;
let _seedOnceDone = false;

async function runSeed(): Promise<void> {
  const seeds = await getSeedReviews();
  // Upsert ALL seeds (not just missing) to backfill new fields like category.
  // The backend uses ON CONFLICT DO UPDATE so this is idempotent — it preserves
  // adoption_count and last_adopted_at while updating changed fields.
  if (seeds.length === 0) return;
  await batchImportDesignReviews(seeds);
  // Prune stale seed rows whose IDs are no longer in the catalog (renamed or
  // deleted template files). Only affects seed rows.
  const activeIds = await getActiveSeedIds();
  if (activeIds.length > 0) {
    await deleteStaleSeedTemplates(SEED_RUN_ID, activeIds);
  }
}

/**
 * Seed the template catalog into the DB exactly once per app session.
 *
 * Safe to call from multiple mount sites — the Templates page hook, the
 * app-init bootstrap, onboarding — because concurrent callers share one
 * in-flight promise and the completed flag short-circuits later calls. The
 * DB layer is idempotent too (upsert via ON CONFLICT DO UPDATE), so a
 * duplicate call is harmless even if the guard is bypassed.
 *
 * This is what makes the onboarding template picker and the gallery non-empty
 * on a fresh install without first navigating to the Templates page — the
 * app-init bootstrap calls it behind requestIdleCallback so it never gates
 * first paint.
 *
 * `force` (dev only) bypasses the session guard so edited template JSON
 * re-seeds after a hot reload.
 */
export async function seedCatalogTemplatesOnce(opts?: { force?: boolean }): Promise<void> {
  if (opts?.force) {
    _seedOnceDone = false;
    _seedOncePromise = null;
  }
  if (_seedOnceDone) return;
  if (_seedOncePromise) return _seedOncePromise;
  _seedOncePromise = runSeed();
  try {
    await _seedOncePromise;
    _seedOnceDone = true;
  } finally {
    _seedOncePromise = null;
  }
}

export { SEED_RUN_ID };

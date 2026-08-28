import { getCachedLightFields, getCachedDesignResult } from './reviewParseCache';
import { resolveConnectorStatuses } from '../../shared/useConnectorReadiness';
import type { ConnectorReadinessMap } from '../../shared/useConnectorReadiness';
import { computeDifficulty, estimateSetupMinutes } from '../../shared/templateComplexity';
import type { DifficultyLevel } from '../../shared/templateComplexity';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { SuggestedTrigger } from '@/lib/types/designTypes';

export interface CompareConnector {
  name: string;
  /** `null` while the authoritative resolver has not answered yet. */
  ready: boolean | null;
}

/** One column of the side-by-side comparison — all dimensions for a single template. */
export interface CompareColumn {
  id: string;
  name: string;
  category: string | null;
  goal: string | null;
  connectors: CompareConnector[];
  triggerCount: number;
  flowCount: number;
  difficulty: DifficultyLevel;
  setupMinutes: number;
  adoptionCount: number;
  /** Whether the review carries a parsed design result — gates Try-it. */
  hasDesign: boolean;
}

/**
 * Derive comparison columns from the selected reviews. Pure — reuses the same
 * cached parse + complexity + readiness helpers the cards use, so the compare
 * view never disagrees with what a card shows for the same template.
 */
export function buildComparison(
  reviews: PersonaDesignReview[],
  connectorReadiness: ConnectorReadinessMap,
): CompareColumn[] {
  return reviews.map((review) => {
    const { connectors, flowCount } = getCachedLightFields(review);
    const designResult = getCachedDesignResult(review);

    // Resolve over the union of what the template declares and what its design
    // result suggests, so a connector named in only one of the two still gets
    // the authoritative verdict rather than silently defaulting to not-ready.
    const readiness = resolveConnectorStatuses(
      [...connectors, ...(designResult?.suggested_connectors ?? [])],
      connectorReadiness,
    );
    const readyMap = new Map(
      readiness.map((s) => [s.connector_name, s.health === 'unknown' ? null : s.health === 'ready']),
    );

    const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];
    const triggerTypes = parseJsonOrDefault<string[]>(review.trigger_types, []);
    const triggerCount = suggestedTriggers.length > 0 ? suggestedTriggers.length : triggerTypes.length;

    const raw = designResult as unknown as Record<string, unknown> | null;
    const persona = raw?.persona as Record<string, unknown> | undefined;
    const goalVal = persona?.goal;
    const goal = typeof goalVal === 'string' && goalVal.trim() ? goalVal.trim() : null;

    return {
      id: review.id,
      name: review.test_case_name,
      category: review.category,
      goal,
      connectors: connectors.map((name) => ({ name, ready: readyMap.get(name) ?? null })),
      triggerCount,
      flowCount,
      difficulty: computeDifficulty(review),
      setupMinutes: estimateSetupMinutes(review),
      adoptionCount: review.adoption_count,
      hasDesign: designResult != null,
    };
  });
}

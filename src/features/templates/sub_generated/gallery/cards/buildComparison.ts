import { getCachedLightFields, getCachedDesignResult } from './reviewParseCache';
import { deriveConnectorReadiness } from '../../shared/ConnectorReadiness';
import { computeDifficulty, estimateSetupMinutes } from '../../shared/templateComplexity';
import type { DifficultyLevel } from '../../shared/templateComplexity';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { SuggestedTrigger } from '@/lib/types/designTypes';

export interface CompareConnector {
  name: string;
  ready: boolean;
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
}

/**
 * Derive comparison columns from the selected reviews. Pure — reuses the same
 * cached parse + complexity + readiness helpers the cards use, so the compare
 * view never disagrees with what a card shows for the same template.
 */
export function buildComparison(
  reviews: PersonaDesignReview[],
  installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
): CompareColumn[] {
  return reviews.map((review) => {
    const { connectors, flowCount } = getCachedLightFields(review);
    const designResult = getCachedDesignResult(review);

    const readiness = designResult?.suggested_connectors
      ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
      : [];
    const readyMap = new Map(readiness.map((s) => [s.connector_name, s.health === 'ready']));

    const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];
    const triggerTypes = parseJsonSafe<string[]>(review.trigger_types, []);
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
      connectors: connectors.map((name) => ({ name, ready: readyMap.get(name) ?? false })),
      triggerCount,
      flowCount,
      difficulty: computeDifficulty(review),
      setupMinutes: estimateSetupMinutes(review),
      adoptionCount: review.adoption_count,
    };
  });
}

import { useMemo } from 'react';
import { deriveConnectorReadiness } from '../../shared/ConnectorReadiness';
import { computeAdoptionReadiness, readinessTier } from '../../shared/adoptionReadiness';
import { computeDifficulty, computeSetupLevel, estimateSetupMinutes, DIFFICULTY_META, SETUP_META } from '../../shared/templateComplexity';
import { verifyTemplate, detectTemplateOrigin, deriveTrustLevel, getSandboxPolicy } from '@/lib/templates/templateVerification';
import { getCachedDesignResult, getCachedLightFields, getCachedVerification, getCachedReadinessScore } from './reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { SuggestedTrigger } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';

/**
 * Cheap verification that skips the content-hash computation.
 * Returns the correct trustLevel/origin without hashing the design_result JSON.
 */
function verifyTemplateLight(review: PersonaDesignReview) {
  const origin = detectTemplateOrigin({
    testCaseId: review.test_case_id,
    testRunId: review.test_run_id,
    isDesignGenerated: !review.test_run_id.startsWith('seed-'),
  });
  const integrityValid = origin === 'builtin' || origin === 'generated';
  const trustLevel = deriveTrustLevel(origin, integrityValid);
  const sandboxPolicy = getSandboxPolicy(trustLevel);
  return { origin, trustLevel, contentHash: null, integrityValid, sandboxPolicy };
}

export function useTemplateCardData(
  review: PersonaDesignReview,
  installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
  isActive = false,
) {
  const parsedData = useMemo(() => {
    const { connectors } = getCachedLightFields(review);
    const triggerTypes = parseJsonSafe<string[]>(review.trigger_types, []);
    const designResult = getCachedDesignResult(review);
    const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
    const displayFlows = flows.length > 0
      ? flows
      : (() => {
          const raw = designResult as unknown as Record<string, unknown> | null;
          return raw?.use_case_flows
            ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
            : [];
        })();

    return { connectors, triggerTypes, designResult, displayFlows };
  }, [review]);

  const { connectors, triggerTypes, designResult, displayFlows } = parsedData;

  const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];

  const readinessStatuses = useMemo(
    () => designResult?.suggested_connectors
      ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
      : [],
    [designResult?.suggested_connectors, installedConnectorNames, credentialServiceTypes],
  );

  // Deferred: only compute full verification (with content hash) on hover/expand.
  // Until then, use the cheap origin-only check (same trustLevel, no hash).
  const verification = useMemo(() => {
    if (!isActive) return verifyTemplateLight(review);
    return getCachedVerification(review, verifyTemplate);
  }, [isActive, review]);

  // Deferred: only compute adoption readiness score on hover/expand.
  const readinessScore = useMemo(() => {
    if (!isActive) return -1;
    return getCachedReadinessScore(review, computeAdoptionReadiness, installedConnectorNames, credentialServiceTypes);
  }, [isActive, review, installedConnectorNames, credentialServiceTypes]);
  const tier = readinessScore >= 0 ? readinessTier(readinessScore) : null;

  const personaGoal = useMemo(() => {
    const raw = designResult as unknown as Record<string, unknown> | null;
    const persona = raw?.persona as Record<string, unknown> | undefined;
    const goal = persona?.goal;
    return typeof goal === 'string' && goal.trim() ? goal.trim() : null;
  }, [designResult]);

  const systemPromptPreview = useMemo(() => {
    if (!designResult?.structured_prompt) return null;
    const identity = designResult.structured_prompt.identity || '';
    return identity.length > 200 ? identity.slice(0, 200) + '...' : identity;
  }, [designResult]);

  const difficulty = useMemo(() => computeDifficulty(review), [review]);
  const difficultyMeta = DIFFICULTY_META[difficulty];
  const setupLevel = useMemo(() => computeSetupLevel(review), [review]);
  const setupMeta = SETUP_META[setupLevel];
  const setupMinutes = useMemo(() => estimateSetupMinutes(review), [review]);

  return {
    connectors,
    triggerTypes,
    designResult,
    displayFlows,
    suggestedTriggers,
    readinessStatuses,
    readinessScore: readinessScore >= 0 ? readinessScore : null,
    tier,
    verification,
    systemPromptPreview,
    difficulty,
    difficultyMeta,
    setupLevel,
    setupMeta,
    setupMinutes,
    personaGoal,
  };
}

import { useMemo } from 'react';
import { resolveConnectorStatuses } from '../../shared/useConnectorReadiness';
import type { ConnectorReadinessMap } from '../../shared/useConnectorReadiness';
import { computeAdoptionReadiness, readinessTier } from '../../shared/adoptionReadiness';
import { computeDifficulty, computeSetupLevel, estimateSetupMinutes, DIFFICULTY_META, SETUP_META } from '../../shared/templateComplexity';
import {
  verifyTemplate,
  detectTemplateOrigin,
  deriveTrustLevel,
  getSandboxPolicy,
  computeContentHashSync,
  expectedBuiltinContentHash,
  resolveIntegrityValid,
} from '@/lib/templates/templateVerification';
import { getCachedDesignResult, getCachedLightFields, getCachedVerification, getCachedReadinessScore } from './reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { SuggestedTrigger } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';

/**
 * Cheap verification that skips the content-hash computation.
 * Returns the correct trustLevel/origin without hashing the design_result JSON.
 *
 * The one case it DOES hash is a built-in the seeder has fingerprinted: the
 * compact TrustBadge on the card header reads this path, so skipping the
 * comparison here would leave a tampered payload wearing ShieldCheck until
 * someone hovered it. `contentHash` is still reported as null when there is
 * nothing to compare against, which is what keeps the fast path fast.
 */
function verifyTemplateLight(review: PersonaDesignReview) {
  const origin = detectTemplateOrigin({
    testCaseId: review.test_case_id,
    testRunId: review.test_run_id,
    isDesignGenerated: !review.test_run_id.startsWith('seed-'),
  });
  const expected = expectedBuiltinContentHash(review.test_case_id);
  const contentHash = expected !== null && review.design_result
    ? computeContentHashSync(review.design_result)
    : null;
  const integrityValid = resolveIntegrityValid(origin, review.test_case_id, contentHash);
  const trustLevel = deriveTrustLevel(origin, integrityValid);
  const sandboxPolicy = getSandboxPolicy(trustLevel);
  return { origin, trustLevel, contentHash, integrityValid, sandboxPolicy };
}

export function useTemplateCardData(
  review: PersonaDesignReview,
  installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
  connectorReadiness: ConnectorReadinessMap,
  isActive = false,
) {
  const parsedData = useMemo(() => {
    const { connectors } = getCachedLightFields(review);
    const triggerTypes = parseJsonOrDefault<string[]>(review.trigger_types, []);
    const designResult = getCachedDesignResult(review);
    const flows = parseJsonOrDefault<UseCaseFlow[]>(review.use_case_flows, []);
    const displayFlows = flows.length > 0
      ? flows
      : (() => {
          const raw = designResult as unknown as Record<string, unknown> | null;
          return raw?.use_case_flows
            ? parseJsonOrDefault<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
            : [];
        })();

    return { connectors, triggerTypes, designResult, displayFlows };
  }, [review]);

  const { connectors, triggerTypes, designResult, displayFlows } = parsedData;

  const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];

  // Authoritative readiness, resolved in Rust and looked up here. Covers the
  // union of the template's declared connectors and its design result's
  // suggestions so neither source can silently read as not-ready.
  const readinessStatuses = useMemo(
    () => resolveConnectorStatuses(
      [...connectors, ...(designResult?.suggested_connectors ?? [])],
      connectorReadiness,
    ),
    [connectors, designResult?.suggested_connectors, connectorReadiness],
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

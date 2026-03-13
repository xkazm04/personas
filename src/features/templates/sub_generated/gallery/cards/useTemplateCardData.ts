import { useMemo } from 'react';
import { deriveConnectorReadiness } from '../../shared/ConnectorReadiness';
import { computeAdoptionReadiness, readinessTier } from '../../shared/adoptionReadiness';
import { verifyTemplate } from '@/lib/templates/templateVerification';
import { getCachedDesignResult, getCachedLightFields } from './reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { SuggestedTrigger } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';

export function useTemplateCardData(
  review: PersonaDesignReview,
  installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
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
  }, [review.connectors_used, review.trigger_types, review.design_result, review.use_case_flows]);

  const { connectors, triggerTypes, designResult, displayFlows } = parsedData;

  const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];

  const readinessStatuses = useMemo(
    () => designResult?.suggested_connectors
      ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
      : [],
    [designResult?.suggested_connectors, installedConnectorNames, credentialServiceTypes],
  );

  const readinessScore = useMemo(
    () => computeAdoptionReadiness(review, installedConnectorNames, credentialServiceTypes),
    [review, installedConnectorNames, credentialServiceTypes],
  );
  const tier = readinessTier(readinessScore);

  const verification = useMemo(() => verifyTemplate({
    testCaseId: review.test_case_id,
    testRunId: review.test_run_id,
    isDesignGenerated: !review.test_run_id.startsWith('seed-'),
    designResultJson: review.design_result,
  }), [review.test_case_id, review.test_run_id, review.design_result]);

  const systemPromptPreview = useMemo(() => {
    if (!designResult?.structured_prompt) return null;
    const identity = designResult.structured_prompt.identity || '';
    return identity.length > 200 ? identity.slice(0, 200) + '...' : identity;
  }, [designResult]);

  return {
    connectors,
    triggerTypes,
    designResult,
    displayFlows,
    suggestedTriggers,
    readinessStatuses,
    readinessScore,
    tier,
    verification,
    systemPromptPreview,
  };
}

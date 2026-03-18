/**
 * Build Session Enricher -- Extracts actionable hints from lab test metadata
 * for consumption by the PersonaMatrix build system.
 */

import type { LabTestMetadata } from './labFeedbackLoop';

export interface BuildHints {
  recommendedModel: string | null;
  knownWeaknesses: string[];
  errorHandlingGaps: string[];
  validatedStrengths: string[];
}

/**
 * Extract actionable build hints from lab test metadata.
 *
 * Returns null if no metadata is available, allowing callers to
 * short-circuit when no test data exists for the persona.
 */
export function extractBuildHints(testMetadata?: LabTestMetadata): BuildHints | null {
  if (!testMetadata) return null;

  return {
    recommendedModel: testMetadata.modelRecommendation,
    knownWeaknesses: testMetadata.weaknesses.map(
      (w) => `${w.scenario}: ${w.metric} scored ${w.score}`,
    ),
    errorHandlingGaps: testMetadata.weaknesses
      .filter(
        (w) =>
          w.metric === 'Protocol Compliance' ||
          w.scenario.toLowerCase().includes('error'),
      )
      .map((w) => w.scenario),
    validatedStrengths: testMetadata.strengths.map(
      (s) => `${s.scenario}: ${s.metric} scored ${s.score}`,
    ),
  };
}

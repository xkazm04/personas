/**
 * Lab Feedback Loop -- Computes test metadata for enriching design_context
 * after lab runs complete. This creates a feedback loop from testing back
 * into persona building.
 */

export interface ScoreEntry {
  scenario: string;
  metric: string;
  score: number;
}

export interface LabTestMetadata {
  testCoverage: number;
  avgCompositeScore: number;
  modelRecommendation: string | null;
  weaknesses: ScoreEntry[];
  strengths: ScoreEntry[];
  lastTestedAt: string;
}

interface ResultInput {
  scenarioName: string;
  status: string;
  toolAccuracyScore: number | null;
  outputQualityScore: number | null;
  protocolCompliance: number | null;
  rationale: string | null;
  suggestions: string | null;
}

const SCORE_METRICS = ['toolAccuracyScore', 'outputQualityScore', 'protocolCompliance'] as const;
const METRIC_LABELS: Record<string, string> = {
  toolAccuracyScore: 'Tool Accuracy',
  outputQualityScore: 'Output Quality',
  protocolCompliance: 'Protocol Compliance',
};

const WEAKNESS_THRESHOLD = 50;
const STRENGTH_THRESHOLD = 80;

/**
 * Build test metadata suitable for embedding in design_context.
 *
 * @param mode - Lab mode that produced the results (arena, ab, eval, matrix)
 * @param results - Flattened result rows from the run
 * @param modelsTested - Model IDs that participated in the run
 */
export function buildTestMetadataForDesignContext(
  _mode: string,
  results: ResultInput[],
  modelsTested: string[],
): LabTestMetadata {
  // Unique scenarios tested
  const uniqueScenarios = new Set(results.map((r) => r.scenarioName));
  const testCoverage = uniqueScenarios.size;

  // Compute per-result composite scores and per-model averages
  const modelScores: Record<string, number[]> = {};
  const allComposites: number[] = [];
  const weaknesses: ScoreEntry[] = [];
  const strengths: ScoreEntry[] = [];

  for (const r of results) {
    const scores: number[] = [];
    for (const metric of SCORE_METRICS) {
      const val = r[metric];
      if (val == null) continue;
      scores.push(val);

      // Track weaknesses and strengths
      if (val < WEAKNESS_THRESHOLD) {
        weaknesses.push({ scenario: r.scenarioName, metric: METRIC_LABELS[metric] ?? metric, score: val });
      }
      if (val >= STRENGTH_THRESHOLD) {
        strengths.push({ scenario: r.scenarioName, metric: METRIC_LABELS[metric] ?? metric, score: val });
      }
    }

    if (scores.length > 0) {
      const composite = scores.reduce((a, b) => a + b, 0) / scores.length;
      allComposites.push(composite);

      // For model recommendation: try to extract modelId from results if available
      // Results from arena/eval have a modelId field -- we'll look at the object shape
      const modelId = (r as unknown as Record<string, unknown>)['modelId'] as string | undefined;
      if (modelId) {
        if (!modelScores[modelId]) modelScores[modelId] = [];
        modelScores[modelId].push(composite);
      }
    }
  }

  const avgCompositeScore = allComposites.length > 0
    ? Math.round((allComposites.reduce((a, b) => a + b, 0) / allComposites.length) * 100) / 100
    : 0;

  // Find the model with the highest average composite score
  let modelRecommendation: string | null = null;
  let bestAvg = -1;
  for (const [modelId, scores] of Object.entries(modelScores)) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      modelRecommendation = modelId;
    }
  }

  // If no model-level data, use the first model tested as a fallback only if there's one
  if (!modelRecommendation && modelsTested.length === 1) {
    modelRecommendation = modelsTested[0] ?? null;
  }

  return {
    testCoverage,
    avgCompositeScore,
    modelRecommendation,
    weaknesses,
    strengths,
    lastTestedAt: new Date().toISOString(),
  };
}

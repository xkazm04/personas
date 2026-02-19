export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-3.5': { input: 0.25, output: 1.25 },
  'claude-sonnet-3.5': { input: 3, output: 15 },
  'claude-opus-3': { input: 15, output: 75 },
};

/** Estimate cost from token counts. Price per 1M tokens. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { inputCost: number; outputCost: number; totalCost: number } {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['claude-sonnet-4']!;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

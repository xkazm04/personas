/** Price per 1M tokens (input / output). Keyed by model family prefix. */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4': { input: 0.25, output: 1.25 },
  'claude-haiku-3.5': { input: 0.25, output: 1.25 },
  'claude-sonnet-3.5': { input: 3, output: 15 },
  'claude-opus-3': { input: 15, output: 75 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Google
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite': { input: 0.05, output: 0.2 },
};

/** Prefixes that indicate a local / self-hosted model with zero API cost. */
const FREE_MODEL_PREFIXES = [
  'ollama', 'local', 'llama', 'mistral/', 'codellama',
  'deepseek', 'phi-', 'qwen', 'vicuna', 'yi-',
];

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  /** True when the model was not recognized -- cost is zero rather than a guess. */
  estimated: boolean;
}

/** Estimate cost from token counts. Price per 1M tokens.
 *  Resolution order: exact match -> longest prefix match -> local-model check -> zero fallback.
 *  Prefix matching handles versioned IDs like claude-sonnet-4-6 or claude-haiku-4-5-20251001
 *  without requiring an explicit entry for every release.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  // Exact match
  const exact = MODEL_PRICING[model];
  if (exact) {
    const inputCost = (inputTokens / 1_000_000) * exact.input;
    const outputCost = (outputTokens / 1_000_000) * exact.output;
    return { inputCost, outputCost, totalCost: inputCost + outputCost, estimated: false };
  }

  // Longest prefix match
  const prefixMatch = Object.entries(MODEL_PRICING)
    .filter(([key]) => model.startsWith(key))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (prefixMatch) {
    const pricing = prefixMatch[1];
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return { inputCost, outputCost, totalCost: inputCost + outputCost, estimated: false };
  }

  // Local / free models -- zero cost, not estimated (we know it's free)
  const lower = model.toLowerCase();
  if (FREE_MODEL_PREFIXES.some((p) => lower.startsWith(p))) {
    return { inputCost: 0, outputCost: 0, totalCost: 0, estimated: false };
  }

  // Unknown model -- zero cost to avoid false budget alerts
  console.warn(
    `[pricing] Unknown model "${model}" -- cost defaulting to $0. Budget totals may undercount actual spend.`,
  );
  return { inputCost: 0, outputCost: 0, totalCost: 0, estimated: true };
}

/** Returns true when the model string matches a known pricing entry or a free-model prefix. */
export function isModelRecognized(model: string | null | undefined): boolean {
  if (!model) return true; // no model configured -- nothing to warn about
  if (MODEL_PRICING[model]) return true;
  if (Object.keys(MODEL_PRICING).some((key) => model.startsWith(key))) return true;
  const lower = model.toLowerCase();
  if (FREE_MODEL_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return false;
}

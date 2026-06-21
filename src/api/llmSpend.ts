import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { LlmSpendDashboard } from '@/lib/bindings/LlmSpendDashboard';

/**
 * Headless LLM spend rollup (`llm_spend_dashboard`) over the last `windowDays`
 * — the `dev_llm_spend` ledger covering the background scanner / evaluator /
 * design / recipe tiers (the calls that don't show up in per-execution cost or
 * Athena's own usage). Powers the Overview → Activity "LLM Spend" lane.
 */
export async function llmSpendDashboard(windowDays: number): Promise<LlmSpendDashboard> {
  return invoke<LlmSpendDashboard>('llm_spend_dashboard', { windowDays });
}

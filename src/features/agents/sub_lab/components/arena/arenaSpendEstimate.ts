/**
 * Preflight spend estimate for an arena match.
 *
 * `duelCount = contenders x scenarios` was already computed for the formula
 * bar, so the size of the sweep was on screen; what was missing is what it
 * costs. Begin the Match dispatched straight into `run_lab_eval`, so a
 * 4-model x 12-use-case selection was 48 LLM calls with no priced preview.
 *
 * Two rules this module exists to hold:
 *  1. Prices come from ANTHROPIC_TIERS, the one place the app declares them.
 *  2. A model with no entry there is UNPRICED, never $0. Coercing an Ollama
 *     contender to zero would report a cheaper match than the one that runs,
 *     which is the failure mode the estimate is meant to prevent.
 */
import { ANTHROPIC_TIERS } from '@/features/agents/sub_model_config/libs/compareHelpers';
import { formatCost } from '@/lib/utils/formatters';

/**
 * Tokens assumed per duel. Deliberately a round, conservative pair rather
 * than a measured average: the estimate's job is to stop an operator
 * launching a match an order of magnitude bigger than they meant, and it is
 * labelled as an estimate at the render site.
 */
export const ESTIMATED_INPUT_TOKENS_PER_DUEL = 4_000;
export const ESTIMATED_OUTPUT_TOKENS_PER_DUEL = 1_000;

/**
 * A dollar figure derived from a TOKEN HEURISTIC, not from a measured run.
 *
 * It is a wrapper rather than a `number` on purpose (golden path
 * `data-provenance-disclosure`): the provenance of this figure lives in the
 * identifier, and an identifier does not survive an arithmetic operator. As a
 * bare number an estimate and a measured cost are the same type and will be
 * added, averaged and rendered alike - which is exactly how a heuristic ends
 * up gating a budget warning. Reading the number back is an explicit,
 * named act.
 */
export class EstimatedCost {
  private constructor(private readonly usd: number) {}

  static fromUsd(usd: number): EstimatedCost {
    return new EstimatedCost(usd);
  }

  /** The figure, for rendering. Name the estimate wherever you print it. */
  toUsd(): number {
    return this.usd;
  }
}

export interface ArenaContender {
  id: string;
  label: string;
}

export interface ArenaSpendEstimate {
  /** Total cells the match will run. */
  duelCount: number;
  /** Duels whose model carries a published price. */
  pricedDuels: number;
  /** Duels whose model has no published price - excluded from `cost`. */
  unpricedDuels: number;
  /** Labels of the contenders with no published price, in selection order. */
  unpricedLabels: string[];
  /** Spend over the priced duels only. Zero when nothing priced is selected. */
  cost: EstimatedCost;
}

/** USD per duel for one model, or null when the model has no published price. */
export function pricePerDuel(modelId: string): number | null {
  const tier = ANTHROPIC_TIERS.find((tt) => tt.value === modelId);
  if (!tier) return null;
  return (
    (ESTIMATED_INPUT_TOKENS_PER_DUEL / 1_000_000) * tier.inputPerMTok +
    (ESTIMATED_OUTPUT_TOKENS_PER_DUEL / 1_000_000) * tier.outputPerMTok
  );
}

export function estimateArenaSpend(
  contenders: readonly ArenaContender[],
  scenarioCount: number,
): ArenaSpendEstimate {
  const scenarios = Math.max(scenarioCount, 1);
  let estimatedUsd = 0;
  let pricedDuels = 0;
  let unpricedDuels = 0;
  const unpricedLabels: string[] = [];

  for (const c of contenders) {
    const perDuel = pricePerDuel(c.id);
    if (perDuel === null) {
      unpricedDuels += scenarios;
      unpricedLabels.push(c.label);
      continue;
    }
    pricedDuels += scenarios;
    estimatedUsd += perDuel * scenarios;
  }

  return {
    duelCount: contenders.length * scenarios,
    pricedDuels,
    unpricedDuels,
    unpricedLabels,
    cost: EstimatedCost.fromUsd(estimatedUsd),
  };
}

/**
 * The figure, through the app's one money door. `formatCost` already knows
 * that a sub-penny amount is `<$0.01` rather than `$0.00`, and that the
 * separator is locale-dependent while the currency is not.
 */
export function formatEstimatedCost(cost: EstimatedCost): string {
  return formatCost(cost.toUsd(), { precision: 2 });
}

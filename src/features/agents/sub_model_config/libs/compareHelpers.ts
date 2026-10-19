/**
 * The Anthropic tiers and their prices, defined ONCE.
 *
 * This file used to also hold the model A/B compare panel's option list,
 * metric aggregation, row-failure discrimination and telemetry builders. The
 * panel itself was deleted as unmounted (d71e0eb948) and those helpers were
 * left behind with a test as their only reader; the tier table is what a live
 * surface still needs (the arena's preflight spend estimate).
 */
export interface AnthropicTier {
  /** Dropdown value AND the model id sent to the API — they are the same. */
  value: string;
  label: string;
  /** USD per million INPUT tokens. A model with no entry here is UNPRICED,
   *  which is not the same as free. */
  inputPerMTok: number;
  /** USD per million OUTPUT tokens. */
  outputPerMTok: number;
}

export const ANTHROPIC_TIERS: readonly AnthropicTier[] = [
  { value: 'haiku', label: 'Haiku', inputPerMTok: 1, outputPerMTok: 5 },
  { value: 'sonnet', label: 'Sonnet', inputPerMTok: 3, outputPerMTok: 15 },
  { value: 'opus', label: 'Opus', inputPerMTok: 5, outputPerMTok: 25 },
];

/**
 * Athena hands-free decision layer (P3) — core types.
 *
 * A `PendingDecision` is a single numbered-choice the orb bubble surfaces
 * above Athena: a prompt plus 1..9 digit-pickable `options`, with a special
 * `0` "explain + recommend" affordance. Decisions are produced by the
 * aggregator (`useDecisionQueue`) from approvals / human-reviews / incidents,
 * or composed ad-hoc. They are ephemeral store state — never persisted.
 *
 * See `docs/features/companion/athena-decision-layer-plan.md` (Slice 1).
 */

/** One pickable answer in a {@link PendingDecision}. */
export interface DecisionOption {
  /** Stable id (used for keys + analytics). */
  key: string;
  /** Shown on the chip (and spoken in a later voice slice), e.g. "Approve". */
  label: string;
  /** Optional sub-label / secondary line under the label. */
  hint?: string;
  /** The action fired when the user picks this option. */
  run: () => void | Promise<void>;
  /** Renders the chip in a danger treatment (destructive / reject). */
  danger?: boolean;
}

/** Where a {@link PendingDecision} originated. */
export type DecisionSource = 'approval' | 'human_review' | 'incident' | 'adhoc';

/**
 * A single decision awaiting the user's answer. Held one-at-a-time in
 * `companionStore.pendingDecision`. `options` are 1-indexed in the UI (the
 * first option is "1"); `0` is reserved for "explain + recommend".
 */
export interface PendingDecision {
  /** Stable id for the decision (dedupe + queue bookkeeping). */
  id: string;
  /** The question shown (and spoken) — "Shall I resolve this incident?". */
  prompt: string;
  /** 1..9 digit-pickable options. */
  options: DecisionOption[];
  /** Athena's recommendation, shown/spoken when the user picks `0`. */
  recommendation?: string;
  /** Longer explanation, shown alongside `recommendation` on `0`. */
  detail?: string;
  /** Which source produced this decision. */
  source: DecisionSource;
  /** Underlying row id — approval id / review id / incident id. */
  sourceRef?: string;
  /**
   * Serialized context of the underlying row (approval action+params,
   * incident trigger, review body). Not rendered — handed to Athena as
   * grounding data when the user escalates `0` into a `decision-explain`
   * turn, so her explanation cites real fields instead of guessing.
   */
  payload?: string;
  /** Optional element to ring while asking (reuses the guidance highlight). */
  highlightTestId?: string;
  /** Optional route to take the user to for context before asking. */
  navigateRoute?: string;
}

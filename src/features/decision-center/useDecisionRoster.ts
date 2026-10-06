/**
 * useDecisionRoster — the ONE source of decision items and counts.
 *
 * Every reader (the CommandBar strip, the title-bar badge, Athena's orb queue,
 * the Home decisions widget, sidebar badges) reads this; none keeps its own
 * aggregation. WP0 stub: the signature is final, the body lands in package A2.
 *
 * Contract:
 *  - `counts` arrive from one backend round-trip (`dev_tools_pending_counts`)
 *    plus the client-derived chat count. A source that failed sets
 *    `failed: true` on its chip; a count is 0 only when its source answered.
 *  - `items` load lazily: only chips named in `load` are fetched (the peek list
 *    asks for its chip; "Triage all" asks for every chip).
 *  - Items are in `compareDecision` order.
 */
import type { ChipCount, DecisionChip, DecisionItem, HubChip } from './model/decisionModel';
import type { TriageDecision } from '@/features/agents/quick-answer/triage/triageTypes';

export interface DecisionRosterOptions {
  /** Chips whose items should be loaded. Counts are always loaded. */
  load?: readonly DecisionChip[] | 'all';
  enabled?: boolean;
}

export interface DecisionRoster {
  counts: Record<HubChip, ChipCount>;
  /** Sum of the seven decision chips (excludes `ready`). */
  total: number;
  /** Loaded items, ordered by `compareDecision`. */
  items: DecisionItem[];
  byChip: Partial<Record<DecisionChip, DecisionItem[]>>;
  /** Per-chip load error message, when a chip's items failed to load. */
  errors: Partial<Record<HubChip, string>>;
  loading: boolean;
  /**
   * Write a verdict. Optimistically removes the item; REJECTS on a failed
   * write after restoring it (the caller toasts).
   */
  decide: (decision: Omit<TriageDecision, 'item'> & { item: DecisionItem }) => Promise<void>;
  refresh: () => void;
}

export function useDecisionRoster(options: DecisionRosterOptions = {}): DecisionRoster {
  void options;
  throw new Error('useDecisionRoster: not implemented (package A2)');
}

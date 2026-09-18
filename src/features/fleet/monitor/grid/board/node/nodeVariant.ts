// nodeVariant — how a node paints its second row.
//
// Three prototype variants of the same node, behind a switch in the header,
// so the direction can be compared on a live board before one is kept:
//
//   • `ledger` — text first: the state with its dot, a time, a chip or the
//                team name, read left to right.
//   • `badge`  — glyph led: a state glyph in the title row, and the meta row
//                is a run of compact rounded badges.
//   • `meter`  — a thin 3px bar in the state's hue with one right-aligned stat.
//
// A per-viewer preference persisted like the board layout — same guarded
// door, same fallback shape: an unknown stored value reads as the default.

import { createContext, useContext } from 'react';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export const NODE_VARIANTS = ['ledger', 'badge', 'meter'] as const;
export type NodeVariant = (typeof NODE_VARIANTS)[number];

export const NODE_VARIANT_KEY = 'monitor.board.node';
export const DEFAULT_NODE_VARIANT: NodeVariant = 'ledger';

export function isNodeVariant(v: unknown): v is NodeVariant {
  return typeof v === 'string' && (NODE_VARIANTS as readonly string[]).includes(v);
}

/** The persisted variant, or `ledger` for a missing / unknown / unreadable value. */
export function readNodeVariant(): NodeVariant {
  const raw = safeLocalGet(NODE_VARIANT_KEY, 'monitor/nodeVariant read');
  return isNodeVariant(raw) ? raw : DEFAULT_NODE_VARIANT;
}

export function writeNodeVariant(v: NodeVariant): void {
  safeLocalSet(NODE_VARIANT_KEY, v, 'monitor/nodeVariant write');
}

/**
 * What every node on the board reads, whichever board paints it. Threaded
 * as a context rather than as a prop through six components: the variant is
 * one value for the whole board, and the two numbers beside it come from the
 * queue model the boards already share.
 */
export interface NodeContextValue {
  variant: NodeVariant;
  /**
   * Mean session duration the door's estimates imply (`queueVerbs.meanWaitMs`),
   * or `null` with no history — the meter's denominator for a live row.
   */
  meanDurationMs: number | null;
  /** How many rows are queued — the meter's denominator for a queued row. */
  queueLength: number;
}

export const DEFAULT_NODE_CONTEXT: NodeContextValue = {
  variant: DEFAULT_NODE_VARIANT,
  meanDurationMs: null,
  queueLength: 0,
};

export const NodeContext = createContext<NodeContextValue>(DEFAULT_NODE_CONTEXT);

export function useNodeContext(): NodeContextValue {
  return useContext(NodeContext);
}

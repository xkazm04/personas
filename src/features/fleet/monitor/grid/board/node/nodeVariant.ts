// nodeVariant — which of the three STYLES every node on the board wears.
//
// Three visibly different dressings of the same two-row node (title row over
// a symbol row — `nodeSymbols.ts` holds the map), behind a switch in the
// header, so the direction can be compared on a live board:
//
//   • `outline` — quiet: a hairline border in the state hue, a transparent
//                 body, symbols monochrome, hue only on the state symbol.
//   • `accent`  — dense: a 3 px left accent bar in the state hue, a secondary
//                 body, symbols in full hue inside rounded chips.
//   • `tinted`  — bold: the whole body washed in the hue at 8 %, no border,
//                 symbols as hue circles, the elapsed fill as a bottom edge.
//
// A per-viewer preference persisted like the board layout — same guarded
// door, same fallback shape: an unknown stored value reads as the default.
// The three ids this switch had before (`ledger`, `badge`, `meter` — three
// wordings of one meta row, retired 2026-09-18) map forward to their
// successors, so a viewer's persisted choice survives the rename.

import { createContext, useContext } from 'react';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';
import type { NodeStyle } from './nodeSymbols';

export const NODE_VARIANTS = ['outline', 'accent', 'tinted'] as const satisfies readonly NodeStyle[];
export type NodeVariant = (typeof NODE_VARIANTS)[number];

export const NODE_VARIANT_KEY = 'monitor.board.node';
export const DEFAULT_NODE_VARIANT: NodeVariant = 'outline';

/** The retired prototype ids → the style that took each one's place. */
export const LEGACY_NODE_VARIANT: Readonly<Record<string, NodeVariant>> = {
  ledger: 'outline',
  badge: 'accent',
  meter: 'tinted',
};

export function isNodeVariant(v: unknown): v is NodeVariant {
  return typeof v === 'string' && (NODE_VARIANTS as readonly string[]).includes(v);
}

/** The persisted style, its successor for a retired id, or `outline` for a missing / unknown / unreadable value. */
export function readNodeVariant(): NodeVariant {
  const raw = safeLocalGet(NODE_VARIANT_KEY, 'monitor/nodeVariant read');
  if (isNodeVariant(raw)) return raw;
  if (typeof raw === 'string' && raw in LEGACY_NODE_VARIANT) return LEGACY_NODE_VARIANT[raw]!;
  return DEFAULT_NODE_VARIANT;
}

export function writeNodeVariant(v: NodeVariant): void {
  safeLocalSet(NODE_VARIANT_KEY, v, 'monitor/nodeVariant write');
}

/**
 * What every node on the board reads, whichever board paints it. Threaded
 * as a context rather than as a prop through six components: the style is
 * one value for the whole board, and the two numbers beside it come from the
 * queue model the boards already share.
 */
export interface NodeContextValue {
  variant: NodeVariant;
  /**
   * Mean session duration the door's estimates imply (`queueVerbs.meanWaitMs`),
   * or `null` with no history — the elapsed ring's denominator for a live row.
   */
  meanDurationMs: number | null;
  /** How many rows are queued — the elapsed ring's denominator for a queued row. */
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

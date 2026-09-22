// nodeContext — the two numbers every node on the board reads, whichever
// board paints it.
//
// This file used to carry the node STYLE switch as well (outline / accent /
// tinted, persisted under `monitor.board.node`). The operator picked tinted;
// the switch, its storage key and the other two styles are gone, and the
// treatment lives as constants in `nodeSymbols.ts`. A stale
// `monitor.board.node` entry in a viewer's localStorage is inert.

import { createContext, useContext } from 'react';

/**
 * Threaded as a context rather than as a prop through six components: both
 * numbers come from the queue model the boards already share.
 */
export interface NodeContextValue {
  /**
   * Mean session duration the door's estimates imply (`queueVerbs.meanWaitMs`),
   * or `null` with no history — the elapsed bar's denominator for a live row.
   */
  meanDurationMs: number | null;
  /** How many rows are queued — the elapsed bar's denominator for a queued row. */
  queueLength: number;
}

export const DEFAULT_NODE_CONTEXT: NodeContextValue = {
  meanDurationMs: null,
  queueLength: 0,
};

export const NodeContext = createContext<NodeContextValue>(DEFAULT_NODE_CONTEXT);

export function useNodeContext(): NodeContextValue {
  return useContext(NodeContext);
}

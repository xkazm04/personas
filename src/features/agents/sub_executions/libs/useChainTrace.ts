import { useState, useEffect } from 'react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { ChainStopReason } from '@/lib/bindings/ChainStopReason';
import { getExecutionTrace, getChainTrace, getChainStopReasons } from '@/api/agents/executions';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

export interface ChainTraceState {
  /** Ordered (by created_at) traces sharing this run's chain_trace_id. */
  traces: ExecutionTrace[];
  loading: boolean;
  error: string | null;
  /** This run belongs to a chain (its trace carries a chain_trace_id). */
  hasChain: boolean;
  /** Chain exists but only this run's trace is accessible (others may belong to
   *  another persona and are filtered out by the backend for privacy). */
  partial: boolean;
  /** Ordered (oldest-first) reasons the chain relay did NOT continue at each
   *  non-continuation link — the "why did it end here" audit. */
  stopReasons: ChainStopReason[];
  /** Summed cost (USD) of every accessible trace in the chain. */
  chainCostUsd: number;
}

const EMPTY: ChainTraceState = {
  traces: [],
  loading: false,
  error: null,
  hasChain: false,
  partial: false,
  stopReasons: [],
  chainCostUsd: 0,
};

/** Sum every span's cost across every accessible trace in the chain. */
function sumChainCost(traces: ExecutionTrace[]): number {
  return traces.reduce(
    (chainSum, trace) =>
      chainSum + trace.spans.reduce((s, span) => s + (span.cost_usd ?? 0), 0),
    0,
  );
}

/**
 * First UI consumer of `get_chain_trace`. Resolves whether an execution is part
 * of a multi-persona/multi-step chain by reading its trace's `chain_trace_id`,
 * then loads every accessible trace in that chain (the backend filters to the
 * caller's own persona), plus the structured stop reasons that explain why the
 * relay ended where it did. Consume-only — no engine changes.
 *
 * @param skip when true the fetch is bypassed (e.g. a nested detail view that
 *   must not recurse into another chain).
 */
export function useChainTrace(executionId: string, personaId: string, skip = false): ChainTraceState {
  const [state, setState] = useState<ChainTraceState>(skip ? EMPTY : { ...EMPTY, loading: true });

  useEffect(() => {
    if (skip) { setState(EMPTY); return; }
    let cancelled = false;
    setState({ ...EMPTY, loading: true });

    (async () => {
      try {
        const trace = await getExecutionTrace(executionId, personaId);
        const chainId = trace?.chain_trace_id ?? null;
        if (!chainId) {
          if (!cancelled) {
            setState({
              ...EMPTY,
              traces: trace ? [trace] : [],
              chainCostUsd: trace ? sumChainCost([trace]) : 0,
            });
          }
          return;
        }
        const chain = await getChainTrace(chainId, personaId);
        const ordered = [...chain].sort((a, b) => a.created_at.localeCompare(b.created_at));
        // Stop reasons are best-effort: a chain still renders if they fail to load.
        const stopReasons = await getChainStopReasons(chainId, personaId).catch((err) => {
          silentCatch(err);
          return [] as ChainStopReason[];
        });
        if (!cancelled) {
          setState({
            traces: ordered,
            loading: false,
            error: null,
            hasChain: true,
            partial: ordered.length <= 1,
            stopReasons,
            chainCostUsd: sumChainCost(ordered),
          });
        }
      } catch (err) {
        if (!cancelled) setState({ ...EMPTY, error: extractMessage(err) });
      }
    })();

    return () => { cancelled = true; };
  }, [executionId, personaId, skip]);

  return state;
}

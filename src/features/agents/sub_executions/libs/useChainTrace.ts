import { useState, useEffect } from 'react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { getExecutionTrace, getChainTrace } from '@/api/agents/executions';
import { extractMessage } from '@/lib/silentCatch';

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
}

const EMPTY: ChainTraceState = { traces: [], loading: false, error: null, hasChain: false, partial: false };

/**
 * First UI consumer of `get_chain_trace`. Resolves whether an execution is part
 * of a multi-persona/multi-step chain by reading its trace's `chain_trace_id`,
 * then loads every accessible trace in that chain (the backend filters to the
 * caller's own persona). Consume-only — no engine changes.
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
          if (!cancelled) setState({ traces: trace ? [trace] : [], loading: false, error: null, hasChain: false, partial: false });
          return;
        }
        const chain = await getChainTrace(chainId, personaId);
        const ordered = [...chain].sort((a, b) => a.created_at.localeCompare(b.created_at));
        if (!cancelled) {
          setState({
            traces: ordered,
            loading: false,
            error: null,
            hasChain: true,
            partial: ordered.length <= 1,
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

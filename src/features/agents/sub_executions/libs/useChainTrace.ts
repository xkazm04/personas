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
  /** Summed cost (USD) of the PRICED spans across every accessible trace in
   *  the chain. Read it together with `chainPricedTraces` — on its own it is
   *  not a chain total. */
  chainCostUsd: number;
  /** How many of `traces` contributed at least one priced span. `0` means the
   *  chain has no measured cost at all (render unknown, not $0.0000); a value
   *  below `traces.length` means the figure covers only part of the chain. */
  chainPricedTraces: number;
}

const EMPTY: ChainTraceState = {
  traces: [],
  loading: false,
  error: null,
  hasChain: false,
  partial: false,
  stopReasons: [],
  chainCostUsd: 0,
  chainPricedTraces: 0,
};

/**
 * Sum the chain's cost under the SAME rule its own rows use.
 *
 * `null` is "we could not price this span"; `0` is "this span was free".
 * `ChainSpanRow` has drawn that distinction since it started printing a dash
 * for an unpriced run, but this accumulator kept folding with `?? 0` — so a
 * chain where only the first step was priced printed a confident, complete
 * -looking total above rows that openly said they did not know. Today the
 * tracer prices the root span alone, which made that the common case rather
 * than the corner one.
 *
 * `pricedTraces` travels with the sum so the header can say "unknown" (nothing
 * priced) or "partial" (some priced) instead of implying a measured total.
 */
function sumChainCost(traces: ExecutionTrace[]): { cost: number; pricedTraces: number } {
  return traces.reduce(
    (acc, trace) => {
      const traceCost = trace.spans.reduce(
        (s, span) => (span.cost_usd == null ? s : { cost: s.cost + span.cost_usd, priced: s.priced + 1 }),
        { cost: 0, priced: 0 },
      );
      return traceCost.priced === 0
        ? acc
        : { cost: acc.cost + traceCost.cost, pricedTraces: acc.pricedTraces + 1 };
    },
    { cost: 0, pricedTraces: 0 },
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
            const solo = sumChainCost(trace ? [trace] : []);
            setState({
              ...EMPTY,
              traces: trace ? [trace] : [],
              chainCostUsd: solo.cost,
              chainPricedTraces: solo.pricedTraces,
            });
          }
          return;
        }
        const chain = await getChainTrace(chainId, personaId);
        const ordered = [...chain].sort((a, b) => a.created_at.localeCompare(b.created_at));
        // Stop reasons are best-effort: a chain still renders if they fail to load.
        const stopReasons = await getChainStopReasons(chainId, personaId).catch((err) => {
          silentCatch('useChainTrace:getChainStopReasons')(err);
          return [] as ChainStopReason[];
        });
        if (!cancelled) {
          const totals = sumChainCost(ordered);
          setState({
            traces: ordered,
            loading: false,
            error: null,
            hasChain: true,
            partial: ordered.length <= 1,
            stopReasons,
            chainCostUsd: totals.cost,
            chainPricedTraces: totals.pricedTraces,
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

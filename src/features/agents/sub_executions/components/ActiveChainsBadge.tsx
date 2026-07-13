import { useState, useEffect, useCallback } from 'react';
import { Waypoints, ChevronDown, ChevronUp } from 'lucide-react';
import { listActiveChains } from '@/api/agents/executions';
import type { ActiveChain } from '@/lib/bindings/ActiveChain';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';

const logger = createLogger('active-chains-badge');
const POLL_INTERVAL_MS = 5_000;

/**
 * Compact operator badge answering "what chains are running right now?" — the
 * live counterpart to the retrospective per-run Chain tab. Polls
 * `list_active_chains` and renders NOTHING when no chain work is in flight
 * (honest empty state, no zero-state chrome). Click to expand a per-chain list.
 */
export function ActiveChainsBadge() {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  const [chains, setChains] = useState<ActiveChain[]>([]);
  const [expanded, setExpanded] = useState(false);

  const fetchChains = useCallback(async () => {
    try {
      setChains(await listActiveChains());
    } catch (err) {
      // Best-effort widget — keep last good state, but leave a breadcrumb so a
      // chronic IPC failure isn't silently invisible.
      logger.warn('Failed to fetch active chains', { error: err });
    }
  }, []);

  // Document-visibility-gated polling — a backgrounded window stops the IPC.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId === null) intervalId = setInterval(fetchChains, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    };
    fetchChains();
    if (typeof document === 'undefined' || !document.hidden) start();
    const onVisibility = () => {
      if (document.hidden) { stop(); }
      else { fetchChains(); start(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [fetchChains]);

  // Honest empty state: nothing in flight → render nothing at all.
  if (chains.length === 0) return null;

  const total = chains.length;

  return (
    <div
      className="border border-primary/20 bg-primary/5 rounded-modal typo-body"
      data-testid="active-chains-badge"
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left"
      >
        <Waypoints className="w-3.5 h-3.5 text-primary/80" />
        <span className="text-foreground font-medium">
          {tx(total === 1 ? e.active_chains_one : e.active_chains_other, { count: total })}
        </span>
        <span className="ml-auto text-foreground">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 pt-1.5 border-t border-primary/10 flex flex-col gap-2">
          <h4 className="typo-caption uppercase tracking-wide text-foreground">
            {e.active_chains_title}
          </h4>
          <ul className="flex flex-col gap-1.5">
            {chains.map((c) => (
              <li
                key={c.chainTraceId}
                className="flex items-center flex-wrap gap-x-3 gap-y-0.5 typo-code"
                data-testid="active-chain-row"
              >
                <span className="font-mono text-foreground" title={c.chainTraceId}>
                  {c.chainTraceId.slice(0, 8)}
                </span>
                <span className="tabular-nums text-foreground">
                  {tx(c.inFlightCount === 1 ? e.active_chains_hops_one : e.active_chains_hops_other, { count: c.inFlightCount })}
                </span>
                <span className="tabular-nums text-foreground">
                  {tx(c.personaIds.length === 1 ? e.active_chains_agents_one : e.active_chains_agents_other, { count: c.personaIds.length })}
                </span>
                <span className="tabular-nums text-foreground">
                  {tx(e.active_chains_depth, { count: c.maxDepth })}
                </span>
                {c.accumulatedCostUsd > 0 && (
                  <Numeric value={c.accumulatedCostUsd} unit="usd" precision={2} className="tabular-nums text-foreground" />
                )}
                <span className="ml-auto text-foreground">
                  <RelativeTime timestamp={c.oldestStartedAt} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

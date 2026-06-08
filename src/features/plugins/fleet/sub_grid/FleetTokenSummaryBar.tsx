import { useEffect, useMemo, useState } from 'react';
import { Coins, Database, Gauge } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { tokenSummary } from '@/api/fleet/fleet';
import type { FleetTokenAggregate } from '@/lib/bindings/FleetTokenAggregate';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

interface Props {
  /** Bound `claudeSessionId`s from the registry snapshot (unbound sessions
   *  have no transcript to aggregate). */
  claudeSessionIds: string[];
}

/** Transcripts grow live; refresh the aggregate on a light cadence. */
const REFRESH_MS = 20_000;

/**
 * Fleet-wide token / cache-efficiency bar. Aggregates per-session transcript
 * rollups into one glance for someone running many CLIs at once: total tokens
 * this run, cache-hit rate (higher is cheaper), and how many sessions are heavy
 * enough to be worth compacting. The aggregate companion to the per-session
 * `FleetContextPill`. Renders nothing until at least one bound session has a
 * transcript.
 */
export function FleetTokenSummaryBar({ claudeSessionIds }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const [agg, setAgg] = useState<FleetTokenAggregate | null>(null);

  // Order-independent key so the effect only re-runs when the *set* of bound
  // sessions changes, not on every parent re-render.
  const idsKey = useMemo(() => [...claudeSessionIds].sort().join(','), [claudeSessionIds]);

  useEffect(() => {
    if (idsKey === '') {
      setAgg(null);
      return;
    }
    let cancelled = false;
    const ids = idsKey.split(',');
    const run = () => {
      tokenSummary(ids)
        .then((a) => { if (!cancelled) setAgg(a); })
        .catch(silentCatch('FleetTokenSummaryBar:tokenSummary'));
    };
    run();
    const h = setInterval(run, REFRESH_MS);
    return () => { cancelled = true; clearInterval(h); };
  }, [idsKey]);

  if (!agg || agg.sessionCount <= 0) return null;

  const input = Number(agg.tokens.input);
  const output = Number(agg.tokens.output);
  const cacheRead = Number(agg.tokens.cacheRead);
  const billable = input + output;
  const cacheDenom = input + cacheRead;
  const cacheHitPct = cacheDenom > 0 ? Math.round((cacheRead / cacheDenom) * 100) : 0;
  const cacheTone =
    cacheHitPct >= 70 ? 'text-emerald-400' : cacheHitPct >= 40 ? 'text-amber-400' : 'text-foreground';
  const bloated = agg.bloatedCount;

  return (
    <div
      data-testid="fleet-token-summary-bar"
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-foreground"
    >
      <span className="inline-flex items-center gap-1.5 tabular-nums" title={f.fleet_total_tokens_hint}>
        <Coins className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
        <span className="opacity-70">{f.fleet_total_tokens}</span>
        <Numeric value={billable} unit="count" />
      </span>

      <span
        className={`inline-flex items-center gap-1.5 tabular-nums ${cacheTone}`}
        title={f.fleet_cache_hit_hint}
      >
        <Database className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{tx(f.fleet_cache_hit, { percent: cacheHitPct })}</span>
      </span>

      {bloated > 0 && (
        <span
          className="inline-flex items-center gap-1.5 tabular-nums text-amber-400"
          title={f.fleet_heavy_hint}
        >
          <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{tx(f.fleet_heavy_sessions, { count: bloated })}</span>
        </span>
      )}
    </div>
  );
}

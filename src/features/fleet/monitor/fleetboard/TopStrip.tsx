// TopStrip — the Board's top edge, one line: how many need you (the verdict,
// in the needs colour, red when any of them is critical), the fleet's mix as
// one bar, the subscription's pace for the 5-hour and 7-day windows, and the
// runs started today.

import { memo, type CSSProperties } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ArrowLeft } from 'lucide-react';
import { Crumbs, Ghost, KitButton } from '@/features/shared/components/kit';
import { TEAMLESS_BAY, type Bay } from './boardModel';
import { formatPercent } from '@/lib/utils/formatters';
import { windowIn, type PlanModel, type WindowModel } from '../grid/usage/useResourceModel';
import { windowSentence, windowTitle } from '../grid/usageBits';
import type { UsageFeed } from '../grid/prototype/useUsageFeed';
import { PILE_ORDER, PILE_VISUAL, pileVisual, type PileCounts } from './piles';

const METER: Record<WindowModel['tone'], string> = {
  ok: PILE_VISUAL.working.tone,
  warning: PILE_VISUAL.warning.tone,
  error: PILE_VISUAL.critical.tone,
};

function Pace({ w }: { w: WindowModel }) {
  const { t, tx } = useTranslation();
  const sentence = windowSentence(t, tx, w);
  return (
    <Tooltip content={sentence}>
      <span role="img" aria-label={sentence} className="flex items-center gap-2" style={{ '--fb-tone': METER[w.tone] } as CSSProperties}>
        <span className="typo-label text-foreground">{windowTitle(t, w)}</span>
        <span className="fb-meter">
          <span style={{ width: `${Math.min(100, w.usedPct)}%` }} />
          {w.elapsedFrac !== null && <b style={{ left: `${w.elapsedFrac * 100}%` }} />}
        </span>
        <span className="typo-data fb-ink">{formatPercent(w.usedPct, { precision: 0 })}</span>
      </span>
    </Tooltip>
  );
}

/** The verdict (how many need you, in the needs colour) and the fleet's mix as one bar. */
function FleetMix({ totals }: { totals: PileCounts }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const tone = totals.critical > 0 ? PILE_VISUAL.critical.tone : totals.needs > 0 ? PILE_VISUAL.warning.tone : PILE_VISUAL.working.tone;
  const verdict = totals.needs === 0 ? m.board_all_clear : totals.needs === 1 ? m.board_needs_one : m.board_needs_other;
  const mixLabel = tx(m.board_mix_aria, { needs: totals.needs, working: totals.working, resting: totals.resting, off: totals.off });
  return (
    <>
      <span className="flex flex-shrink-0 items-baseline gap-2" style={{ '--fb-tone': tone } as CSSProperties}>
        {totals.needs > 0 && <Numeric value={totals.needs} unit="count" className="typo-data-lg fb-ink" />}
        <span className="typo-heading text-foreground">{verdict}</span>
      </span>
      <span className="fb-sep" aria-hidden />
      <span role="img" aria-label={mixLabel} className="flex min-w-0 items-center gap-4 overflow-hidden">
        <span className="fb-mix">
          {PILE_ORDER.filter((p) => totals[p] > 0).map((p) => (
            <i key={p} style={{ flexGrow: totals[p], '--fb-tone': pileVisual(p).tone } as CSSProperties} />
          ))}
        </span>
        {PILE_ORDER.map((p) => (
          <span key={p} className="fb-key" style={{ '--fb-tone': pileVisual(p).tone } as CSSProperties} aria-hidden>
            <i />
            <Numeric value={totals[p]} unit="count" className="typo-data text-foreground" />
            <span className="typo-caption">{m[pileVisual(p).labelKey]}</span>
          </span>
        ))}
      </span>
    </>
  );
}

/** Below the fleet level: the way back (Esc does the same) and where the reader is. */
function ZoomTrail({ bay, onBack }: { bay: Bay; onBack: () => void }) {
  const { t } = useTranslation();
  const m = t.monitor;
  return (
    <span className="flex flex-shrink-0 items-center gap-3">
      <KitButton icon={<ArrowLeft />} hint="Esc" onClick={onBack} testId="monitor-board-back">{m.board_back}</KitButton>
      <Crumbs
        label={m.board_crumbs_aria}
        items={[{ label: m.board_crumb_fleet, onPress: onBack }, { label: bay.id === TEAMLESS_BAY ? m.board_teamless : bay.name }]}
      />
      <span className="fb-sep" aria-hidden />
    </span>
  );
}

/** The plan the fleet is spending: the live Claude login, else the first one read. */
function livePlan(usage: UsageFeed): PlanModel | null {
  const claude = usage.model.providers.find((p) => p.id === 'claude');
  const plans = claude?.plans.filter((p) => p.state === 'ok' || p.state === 'projected') ?? [];
  return plans.find((p) => p.isActive) ?? plans[0] ?? null;
}

export const TopStrip = memo(function TopStrip({ totals, runsToday, usage, loading, zoomed, onBack }: {
  totals: PileCounts;
  runsToday: number;
  usage: UsageFeed;
  /** First read in flight: the counts would claim a calm fleet they have not seen. */
  loading: boolean;
  /** The zoomed team (its counts are the ones shown), or null at fleet level. */
  zoomed: Bay | null;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const plan = livePlan(usage);
  const windows = plan ? [windowIn(plan, 'short'), windowIn(plan, 'long')].filter((w): w is WindowModel => w !== null) : [];

  return (
    <div className={`fb-top${zoomed ? ' is-zoomed' : ''}`}>
      {zoomed && <ZoomTrail bay={zoomed} onBack={onBack} />}
      {loading ? <span className="w-72 flex-shrink-0"><Ghost width="100%" height="14px" /></span> : <FleetMix totals={totals} />}
      <span className="ml-auto flex flex-shrink-0 items-center gap-5">
        {windows.map((w) => <Pace key={w.key} w={w} />)}
        <span className="flex items-baseline gap-1.5">
          {loading ? <Ghost width="32px" height="14px" inline /> : <Numeric value={runsToday} unit="count" className="typo-data-lg text-foreground" />}
          <span className="typo-caption">{m.board_runs_today}</span>
        </span>
      </span>
    </div>
  );
});

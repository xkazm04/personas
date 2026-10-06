/**
 * VARIANT 1 - INSTRUMENT. "The practice read off a precise instrument."
 *
 * Same arrangement, same data, same reading order as the baseline (actions,
 * weakest-step sentence, two-lane rail, legend, state region, evidence ledger).
 * What is redesigned is every component inside it, in one language - gauges,
 * ticks, meters and a cursor:
 *
 * - HEADLINE as a READOUT: a status lamp and the state word on a ruled strip,
 *   then the sentence; a new verdict cross-fades in, it never just swaps.
 * - RAIL nodes as dials, evidence as a tick trace, selection as a gliding
 *   cursor (`InstrumentRail`).
 * - LEGEND as a SPECTRUM: one bar whose segments are how many steps sit in
 *   each state, above a key of ladder rings with their counts - the legend now
 *   carries data, not just a vocabulary.
 * - STATE as a readout with channel meters (`InstrumentState`); LEDGER rows
 *   lead with the rail's own tick (`instrumentColumns`).
 */
import { AnimatePresence, motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';

import { JourneyGhost } from '../journey/JourneyGhost';
import { bindingStateLabel } from '../journey/journeyLabels';
import { LEGEND_STATES, STATE_TEXT } from '../journey/journeyStyles';
import { useLifecycleViewModel } from './context';
import { LifecycleActions } from './blocks/LifecycleActions';
import { LadderRing } from './InstrumentDial';
import { InstrumentRail, TICK } from './InstrumentRail';
import { InstrumentState } from './InstrumentState';
import { instrumentColumns } from './instrumentColumns';
import { VariantLedger } from './VariantLedger';
import { stateCounts } from './variantShared';

const LAMP: Record<LifecycleBindingState, string> = {
  live: 'bg-status-success ring-status-success/25',
  detected: 'bg-status-info ring-status-info/25',
  pending: 'bg-status-warning ring-status-warning/25',
  missing: 'bg-status-error ring-status-error/25',
  advisory: 'bg-foreground/50 ring-foreground/15',
};

const FILL: Record<LifecycleBindingState, string> = {
  live: 'bg-status-success',
  detected: 'bg-status-info',
  pending: 'bg-status-warning',
  missing: 'bg-status-error',
  advisory: 'bg-foreground/30',
};

function Readout() {
  const { dl, headline, headlineState } = useLifecycleViewModel();
  const ink = headlineState ? STATE_TEXT[headlineState] : 'text-foreground';
  return (
    <div className="mx-auto flex w-fit max-w-full items-center gap-3 rounded-card border border-primary/15 px-4 py-2.5">
      {headlineState && (
        <>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${LAMP[headlineState]}`} aria-hidden />
          <span className={`typo-eyebrow shrink-0 ${ink}`}>{bindingStateLabel(dl, headlineState)}</span>
          <span aria-hidden className="h-4 w-px shrink-0 bg-primary/20" />
        </>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={headline}
          className={`typo-body-lg ${ink}`}
          data-testid="lc-weakest"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {headline}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function SpectrumLegend() {
  const { dl, order } = useLifecycleViewModel();
  const counts = stateCounts(order);
  const total = order.length;
  return (
    <div className="mx-auto max-w-2xl space-y-2.5" data-testid="lc-legend">
      {total > 0 && (
        <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {LEGEND_STATES.filter((s) => counts[s] > 0).map((s, i) => (
            <motion.span
              key={s}
              className={`block h-full ${FILL[s]}`}
              initial={{ width: 0 }}
              animate={{ width: `${(counts[s] / total) * 100}%` }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {LEGEND_STATES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 typo-label text-foreground">
            <LadderRing state={s} />
            {bindingStateLabel(dl, s)}
            <Numeric value={counts[s]} className="typo-caption" />
          </span>
        ))}
        <span className="flex items-center gap-2 typo-caption">
          <span className="flex h-3 items-end gap-0.5" aria-hidden>
            <span className={`block w-1 ${TICK.done}`} />
            <span className={`block w-1 ${TICK.skipped}`} />
            <span className={`block w-1 ${TICK.unknown}`} />
            <span className={`block w-1 ${TICK.failed}`} />
          </span>
          {dl.lc_legend_evidence}
        </span>
      </div>
    </div>
  );
}

export function RailBelowVariant1() {
  const { order, loading } = useLifecycleViewModel();
  return (
    <div className="space-y-5 pb-6" data-testid="lc-journey">
      <LifecycleActions />
      <Readout />
      {order.length > 0 ? <InstrumentRail /> : loading ? <JourneyGhost /> : null}
      <SpectrumLegend />
      <div className="min-h-[26rem] border-t border-primary/15 pt-5 space-y-4" data-testid="lc-state-region">
        <InstrumentState />
        <div className="h-[17rem]">
          <VariantLedger columnsFor={instrumentColumns} tableId="lifecycle-evidence-v1" rowHeight={40} />
        </div>
      </div>
    </div>
  );
}

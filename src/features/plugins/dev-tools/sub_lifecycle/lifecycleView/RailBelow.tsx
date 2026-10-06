/**
 * RAIL BELOW - the Lifecycle body. The journey is a horizontal two-lane rail
 * read left to right, the selected step's state is docked in a reserved region
 * beneath it, and the page reads top-down: verdict, journey, state, evidence.
 *
 * TACTILE won the 2026-10-06 prototype round (over Instrument and Editorial,
 * and over the flat baseline): every part is a material control with depth -
 * raised, recessed, seated - and every motion is the physics of pressing one.
 *
 * - HEADLINE as a PLATE: a raised label plate with an indicator lamp; a new
 *   verdict settles onto it with a spring. It carries the weakest step's own
 *   status ink, one type step above the legend.
 * - RAIL as keys in two recessed trays, the selected key SEATED, evidence as
 *   beads in a slot (`TactileRail`, `TactileKeys`).
 * - LEGEND as a row of mini key caps, each with its step count on a raised
 *   tab, and a bead slot as the evidence sample.
 * - STATE as a raised control panel whose counters ROLL between steps
 *   (`TactileState`); LEDGER rows with outcome chips and part-label source tags
 *   (`tactileColumns`, `RailLedger`).
 *
 * The reserved region's min-height is held whether or not a step is selected, so
 * the state panel is never a block that appears and shoves the rail
 * (overview-loading law 6: a region is retired by its OWN data).
 */
import { AnimatePresence, motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';

import { JourneyGhost } from '../journey/JourneyGhost';
import { bindingStateLabel } from '../journey/journeyLabels';
import { LEGEND_STATES, STATE_TEXT } from '../journey/journeyStyles';
import { useLifecycleViewModel } from './context';
import { LifecycleActions } from './blocks/LifecycleActions';
import { BeadTrack, MiniKey } from './TactileKeys';
import { TactileRail } from './TactileRail';
import { TactileState } from './TactileState';
import { tactileColumns } from './tactileColumns';
import { RailLedger } from './RailLedger';
import { OUTCOMES, stateCounts } from './railShared';

const LAMP: Record<LifecycleBindingState, string> = {
  live: 'bg-status-success ring-status-success/20',
  detected: 'bg-status-info ring-status-info/20',
  pending: 'bg-status-warning ring-status-warning/20',
  missing: 'bg-status-error ring-status-error/20',
  advisory: 'bg-foreground/50 ring-foreground/10',
};

function Plate() {
  const { headline, headlineState } = useLifecycleViewModel();
  const ink = headlineState ? STATE_TEXT[headlineState] : 'text-foreground';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={headline}
        className="mx-auto flex w-fit max-w-full items-center gap-3 rounded-card border border-primary/15 bg-gradient-to-b from-secondary/50 to-secondary/20 px-4 py-2.5 shadow-elevation-1"
        initial={{ opacity: 0, scale: 0.97, y: -3 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      >
        {headlineState && <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${LAMP[headlineState]}`} />}
        <p className={`typo-body-lg ${ink}`} data-testid="lc-weakest">{headline}</p>
      </motion.div>
    </AnimatePresence>
  );
}

function KeyLegend() {
  const { dl, order } = useLifecycleViewModel();
  const counts = stateCounts(order);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" data-testid="lc-legend">
      {LEGEND_STATES.map((s) => (
        <span key={s} className="flex items-center gap-2 typo-label text-foreground">
          <MiniKey state={s} />
          {bindingStateLabel(dl, s)}
          <Numeric value={counts[s]} className="typo-caption rounded-full bg-secondary/50 px-1.5 shadow-inner" />
        </span>
      ))}
      <span className="flex items-center gap-2 typo-caption">
        <BeadTrack beads={OUTCOMES.map((o) => ({ key: o, outcome: o }))} delay={0.4} />
        {dl.lc_legend_evidence}
      </span>
    </div>
  );
}

export function RailBelow() {
  const { order, loading } = useLifecycleViewModel();
  return (
    <div className="space-y-5 pb-6" data-testid="lc-journey">
      <LifecycleActions />
      <Plate />
      {order.length > 0 ? <TactileRail /> : loading ? <JourneyGhost /> : null}
      <KeyLegend />
      <div className="min-h-[26rem] border-t border-primary/15 pt-5 space-y-4" data-testid="lc-state-region">
        <TactileState />
        <div className="h-[17rem]">
          <RailLedger columnsFor={tactileColumns} tableId="lifecycle-evidence" rowHeight={44} />
        </div>
      </div>
    </div>
  );
}

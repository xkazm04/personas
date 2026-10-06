/**
 * VARIANT 1 (Instrument) - the selected step's state, as a READOUT. Same content
 * as `blocks/StepState` (name + phase + state, the rule, each binding, the
 * tally); the components that changed:
 *
 * - the header mark is the step's `OutcomeDial` at 72px with the done rate
 *   (done over observed, an em dash when nothing was observed) at its centre;
 * - the tally sentence becomes four CHANNELS: an outcome label, its figure, and
 *   a meter whose fill is that outcome's share of the evidence window - the
 *   meters re-fill from where they stood when you walk to the next step;
 * - the rule is set as a spec line on a primary rule, and each binding is a
 *   row keyed by the same ladder ring the rail draws.
 *
 * Motion: walking the rail slides the readout in from the side the selection
 * came from (`useStepDirection`) - a state transition the user caused, once.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import { formatPercent } from '@/lib/utils/formatters';

import { bindingKindLabel, bindingStateLabel, outcomeLabel, stepGlyph, stepLabel } from '../journey/journeyLabels';
import { OUTCOME_TEXT, STATE_TEXT } from '../journey/journeyStyles';
import { useLifecycleViewModel } from './context';
import { LadderRing, OutcomeDial } from './InstrumentDial';
import { OUTCOMES, doneRatio, tallyTotal, useStepDirection } from './variantShared';

const METER: Record<LifecycleOutcome, string> = {
  done: 'bg-status-success',
  skipped: 'bg-status-warning',
  unknown: 'bg-primary/30',
  failed: 'bg-status-error',
};

const SLIDE = {
  enter: (d: number) => ({ opacity: 0, x: d * 18 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d * -18 }),
};

function Channel({ outcome, value, total, label }: { outcome: LifecycleOutcome; value: number; total: number; label: string }) {
  const share = total === 0 ? 0 : (value / total) * 100;
  return (
    <div className="w-24 space-y-1">
      <span className={`typo-eyebrow ${value > 0 ? OUTCOME_TEXT[outcome] : ''}`}>{label}</span>
      <Numeric value={value} className="block typo-data-lg text-foreground" />
      <span className="block h-1 w-full overflow-hidden rounded-full bg-primary/10" aria-hidden>
        <motion.span
          className={`block h-full ${METER[outcome]}`}
          initial={{ width: 0 }}
          animate={{ width: `${share}%` }}
          transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </span>
    </div>
  );
}

export function InstrumentState() {
  const { dl, tx, order, selected } = useLifecycleViewModel();
  const dir = useStepDirection(order, selected?.id ?? null);
  const label = selected ? stepLabel(dl, selected.id, selected.label) : null;

  useEffect(() => {
    if (!selected || !label) return;
    announceImperative(tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, selected.strongestState) }));
  }, [selected, label, tx, dl]);

  if (!selected || !label) return null;
  const Glyph = stepGlyph(selected.id);
  const state = selected.strongestState;
  const total = tallyTotal(selected.tally);

  return (
    <AnimatePresence mode="wait" initial={false} custom={dir}>
      <motion.div
        key={selected.id}
        custom={dir}
        variants={SLIDE}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="space-y-5"
        data-testid="lc-step-state"
      >
        <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <OutcomeDial tally={selected.tally} state={state} size={72}>
            <span className="flex flex-col items-center">
              <Glyph className={`w-4 h-4 ${STATE_TEXT[state]}`} aria-hidden />
              <span className="typo-data text-foreground">{formatPercent(doneRatio(selected.tally), { fromRatio: true, precision: 0 })}</span>
            </span>
          </OutcomeDial>
          <div className="min-w-0 flex-1">
            <h3 className="typo-section-title truncate">{label}</h3>
            <p className="typo-caption">
              {selected.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}
              <span aria-hidden className="mx-1.5">/</span>
              <span className={`font-semibold ${STATE_TEXT[state]}`}>{bindingStateLabel(dl, state)}</span>
            </p>
          </div>
          <div
            className="flex gap-4"
            aria-label={tx(dl.lc_detail_tally, { ...selected.tally })}
            role="group"
          >
            {OUTCOMES.map((o) => (
              <Channel key={o} outcome={o} value={selected.tally[o]} total={total} label={outcomeLabel(dl, o)} />
            ))}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-8 gap-y-4 items-start">
          <section className="min-w-0 space-y-2">
            <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_rule}</h4>
            <p className="border-l-2 border-primary/40 pl-3 typo-body text-foreground leading-relaxed">{selected.rule}</p>
          </section>

          <section className="min-w-0 space-y-2">
            <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_bindings}</h4>
            {selected.view.bindingViews.length === 0 && <p className="typo-caption">{dl.lc_state_phrase_advisory}</p>}
            <ul className="space-y-1.5 empty:hidden">
              {selected.view.bindingViews.map((b, i) => (
                <motion.li
                  key={b.kind}
                  className="flex items-center gap-3 rounded-interactive border border-primary/10 px-3 py-2"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, delay: 0.08 + i * 0.04 }}
                >
                  <LadderRing state={b.state} size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="typo-body text-foreground">{bindingKindLabel(dl, b.kind)}</p>
                    {b.detail && <p className="typo-code truncate">{b.detail}</p>}
                  </div>
                  <span className={`typo-label ${STATE_TEXT[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
                </motion.li>
              ))}
            </ul>
          </section>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

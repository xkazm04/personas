/**
 * VARIANT 3 (Tactile) - the selected step's state as a CONTROL PANEL. Same
 * content as `blocks/StepState`; the components that changed:
 *
 * - the head carries the step's own key at panel size, seated, so the panel is
 *   visibly "the key you pressed";
 * - the tally is four COUNTER tiles, recessed, each with its outcome's colour
 *   on the tile floor - and the figures ROLL to the next step's values instead
 *   of being replaced, so walking the rail shows what changed between steps;
 * - the rule sits in an inset well; each binding is a raised plate with its
 *   own `MiniKey` and a state pill.
 *
 * Motion: the counters roll (spring, per digit change only); the head, rule and
 * plates swap with a short settle keyed on the step. All of it is caused by a
 * selection; none of it repeats.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { bindingKindLabel, bindingStateLabel, outcomeLabel, stepGlyph, stepLabel } from '../journey/journeyLabels';
import { STATE_TEXT } from '../journey/journeyStyles';
import { useLifecycleViewModel } from './context';
import { KeyCap, MiniKey } from './TactileKeys';
import { OUTCOMES } from './railShared';

const FLOOR: Record<LifecycleOutcome, string> = {
  done: 'bg-status-success',
  skipped: 'bg-status-warning',
  unknown: 'bg-primary/25',
  failed: 'bg-status-error',
};

export const PILL: Record<LifecycleBindingState, string> = {
  live: 'border-status-success/30 bg-status-success/10 text-status-success',
  detected: 'border-status-info/30 bg-status-info/10 text-status-info',
  pending: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  missing: 'border-status-error/30 bg-status-error/10 text-status-error',
  advisory: 'border-primary/20 bg-secondary/40 text-foreground',
};

const SETTLE = {
  initial: { opacity: 0, y: 4, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, transition: { duration: 0.08 } },
  transition: { type: 'spring', stiffness: 500, damping: 34 },
} as const;

function RollingFigure({ value }: { value: number }) {
  return (
    <span className="relative block overflow-hidden typo-data-lg text-foreground" style={{ height: '1.2em', lineHeight: '1.2em' }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          className="block"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        >
          <Numeric value={value} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Counter({ outcome, value, label }: { outcome: LifecycleOutcome; value: number; label: string }) {
  return (
    <div className="relative w-20 overflow-hidden rounded-card border border-primary/10 bg-secondary/30 px-3 pt-1.5 pb-2.5 shadow-inner">
      <RollingFigure value={value} />
      <span className="typo-caption">{label}</span>
      <span aria-hidden className={`absolute inset-x-0 bottom-0 h-1 ${FLOOR[outcome]}`} />
    </div>
  );
}

export function TactileState() {
  const { dl, tx, selected } = useLifecycleViewModel();
  const label = selected ? stepLabel(dl, selected.id, selected.label) : null;

  useEffect(() => {
    if (!selected || !label) return;
    announceImperative(tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, selected.strongestState) }));
  }, [selected, label, tx, dl]);

  if (!selected || !label) return null;
  const Glyph = stepGlyph(selected.id);
  const state = selected.strongestState;

  return (
    <div className="space-y-4 rounded-modal border border-primary/15 bg-background p-4 shadow-elevation-2" data-testid="lc-step-state">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={selected.id} className="flex min-w-0 flex-1 items-center gap-4" {...SETTLE}>
            <KeyCap state={state} pressed size="lg">
              <Glyph className={`w-5 h-5 ${STATE_TEXT[state]}`} aria-hidden />
            </KeyCap>
            <div className="min-w-0">
              <h3 className="typo-section-title truncate">{label}</h3>
              <p className="flex items-center gap-2 typo-caption">
                {selected.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}
                <span className={`rounded-full border px-2 typo-label ${PILL[state]}`}>{bindingStateLabel(dl, state)}</span>
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="flex gap-2" role="group" aria-label={tx(dl.lc_detail_tally, { ...selected.tally })}>
          {OUTCOMES.map((o) => (
            <Counter key={o} outcome={o} value={selected.tally[o]} label={outcomeLabel(dl, o)} />
          ))}
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={selected.id}
          className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-6 gap-y-4 items-start"
          {...SETTLE}
        >
          <section className="min-w-0 space-y-1.5">
            <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_rule}</h4>
            <p className="rounded-card bg-secondary/30 px-3 py-2.5 shadow-inner typo-body text-foreground leading-relaxed">
              {selected.rule}
            </p>
          </section>

          <section className="min-w-0 space-y-1.5">
            <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_bindings}</h4>
            {selected.view.bindingViews.length === 0 && <p className="typo-caption">{dl.lc_state_phrase_advisory}</p>}
            <ul className="space-y-1.5 empty:hidden">
              {selected.view.bindingViews.map((b) => (
                <li
                  key={b.kind}
                  className="flex items-center gap-3 rounded-card border border-primary/10 bg-background px-3 py-2 shadow-elevation-1"
                >
                  <MiniKey state={b.state} />
                  <div className="min-w-0 flex-1">
                    <p className="typo-body text-foreground">{bindingKindLabel(dl, b.kind)}</p>
                    {b.detail && <p className="typo-code truncate">{b.detail}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 typo-label ${PILL[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
                </li>
              ))}
            </ul>
          </section>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

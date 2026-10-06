/**
 * The selected step's state: the same content the retired right-drawer
 * `StepDetailSheet` carried (name + phase, the rule the agent is given, each
 * binding with its state, the tally) rendered in the page's own space, so the
 * steps stay on screen and keep their selection while you walk along them.
 *
 * The region is pre-seeded (the model selects the weakest step), so it is never
 * a block that appears and shoves what is above it. The one announcement goes
 * through the app-root live region rather than a conditional `role="status"`.
 *
 * Three defects of the version this replaces:
 *  - its two section heads were `typo-card-label`, a token whose whole point is
 *    a primary-tinted text-shadow GLOW for card titles. Two glowing mini-heads
 *    inside a diagnostic panel, and no section vocabulary on the surface. They
 *    are `typo-eyebrow`, which exists for exactly this job.
 *  - the phase/state separator was `opacity-40`, i.e. the type scale's job done
 *    by transparency. It is a tokenised ink.
 *  - the head's phase line, its tally and the binding details were all
 *    `typo-caption text-foreground` - four identical lines, so the tally (a
 *    figure) read exactly like the phase (a category). The tally is `typo-data`
 *    with tabular figures, the phase is meta ink, and the state word carries the
 *    one emphasis.
 *
 * `columns` is false for a concept that docks this in a narrow gutter: the rule
 * and the bindings then stack. It changes no content and no order.
 */
import { useEffect } from 'react';

import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';

import { bindingKindLabel, bindingStateLabel, stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { STATE_CHIP, STATE_MARK, STATE_TEXT } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';

const BODY_WIDE = 'grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-6 gap-y-4 items-start';
const BODY_NARROW = 'flex flex-col gap-4';

export function StepState({ columns = true }: { columns?: boolean }) {
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
    <div className="space-y-4" data-testid="lc-step-state">
      <header className="flex items-start gap-3">
        <span
          className={`w-10 h-10 rounded-card flex items-center justify-center shrink-0 ${STATE_MARK[state]}`}
        >
          <Glyph className={`w-4 h-4 ${STATE_TEXT[state]}`} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="typo-section-title truncate">{label}</h3>
          <p className="typo-caption">
            {selected.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}
            <span aria-hidden className="mx-1.5">/</span>
            <span className={`font-semibold ${STATE_TEXT[state]}`}>{bindingStateLabel(dl, state)}</span>
          </p>
        </div>
        <span className="typo-data text-foreground tabular-nums shrink-0 text-right">
          {tx(dl.lc_detail_tally, {
            done: selected.tally.done, skipped: selected.tally.skipped,
            unknown: selected.tally.unknown, failed: selected.tally.failed,
          })}
        </span>
      </header>

      <div className={columns ? BODY_WIDE : BODY_NARROW}>
        <section className="min-w-0 space-y-1.5">
          <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_rule}</h4>
          <p className="typo-body text-foreground leading-relaxed">{selected.rule}</p>
        </section>

        <section className="min-w-0 space-y-1.5">
          <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_bindings}</h4>
          {selected.view.bindingViews.length === 0 && (
            <p className="typo-caption">{dl.lc_state_phrase_advisory}</p>
          )}
          <ul className="divide-y divide-primary/10 rounded-card border border-primary/15 overflow-hidden empty:hidden">
            {selected.view.bindingViews.map((b) => (
              <li key={b.kind} className="flex items-start gap-3 px-3 py-2">
                <span className={`mt-0.5 shrink-0 w-4 h-4 rounded-interactive ${STATE_CHIP[b.state]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="typo-body text-foreground">
                    {bindingKindLabel(dl, b.kind)}
                    <span className={`ml-2 font-semibold ${STATE_TEXT[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
                  </p>
                  {b.detail && <p className="typo-caption truncate">{b.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

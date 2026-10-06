/**
 * The selected step's state, INLINE. This is what replaced the right-drawer
 * `StepDetailSheet`: the same content (name + phase, the rule the agent is
 * given, each binding with its state, the tally) rendered in the page's own
 * space, so the timeline stays on screen and keeps its selection while you walk
 * along it.
 *
 * The region is pre-seeded (the model selects the weakest step), so it is never
 * a block that appears and shoves the timeline. The one announcement goes
 * through the app-root live region rather than a conditional `role="status"`.
 */
import { useEffect } from 'react';

import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';

import { bindingKindLabel, bindingStateLabel, stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { STATE_CHIP, STATE_SHAPE, STATE_TEXT } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';

export function StepState() {
  const { dl, tx, selected } = useLifecycleViewModel();
  const label = selected ? stepLabel(dl, selected.id, selected.label) : null;

  useEffect(() => {
    if (!selected || !label) return;
    announceImperative(tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, selected.strongestState) }));
  }, [selected, label, tx, dl]);

  if (!selected || !label) return null;
  const Glyph = stepGlyph(selected.id);

  return (
    <div className="space-y-3" data-testid="lc-step-state">
      <header className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-card flex items-center justify-center shrink-0 ${STATE_SHAPE[selected.strongestState]}`}>
          <Glyph className={`w-4 h-4 ${STATE_TEXT[selected.strongestState]}`} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="typo-section-title truncate">{label}</h3>
          <p className="typo-caption text-foreground">
            {selected.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}
            <span className="mx-1.5 opacity-40">/</span>
            <span className={STATE_TEXT[selected.strongestState]}>{bindingStateLabel(dl, selected.strongestState)}</span>
          </p>
        </div>
        <span className="typo-caption text-foreground shrink-0 tabular-nums text-right">
          {tx(dl.lc_detail_tally, {
            done: selected.tally.done, skipped: selected.tally.skipped,
            unknown: selected.tally.unknown, failed: selected.tally.failed,
          })}
        </span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-6 gap-y-3 items-start">
        <section className="min-w-0 space-y-1">
          <h4 className="typo-card-label text-foreground">{dl.lc_detail_rule}</h4>
          <p className="typo-body text-foreground leading-relaxed">{selected.rule}</p>
        </section>

        <section className="min-w-0 space-y-1.5">
          <h4 className="typo-card-label text-foreground">{dl.lc_detail_bindings}</h4>
          {selected.view.bindingViews.length === 0 && (
            <p className="typo-caption text-foreground">{dl.lc_state_phrase_advisory}</p>
          )}
          <ul className="divide-y divide-primary/10 rounded-input border border-primary/10 empty:hidden">
            {selected.view.bindingViews.map((b) => (
              <li key={b.kind} className="flex items-start gap-2.5 px-3 py-1.5">
                <span className={`mt-1.5 w-3 h-3 rounded-interactive shrink-0 ${STATE_CHIP[b.state]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="typo-body text-foreground">
                    {bindingKindLabel(dl, b.kind)}
                    <span className={`ml-2 typo-label ${STATE_TEXT[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
                  </p>
                  {b.detail && <p className="typo-caption text-foreground truncate">{b.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

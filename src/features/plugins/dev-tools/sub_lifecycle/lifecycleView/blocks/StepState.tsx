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
 *
 * VISUAL REBUILD, 2026-10-06. Three defects of the version this replaces:
 *  - its two section heads were `typo-card-label`, a token whose whole point is
 *    a primary-tinted text-shadow GLOW for card titles. Two glowing mini-heads
 *    inside a diagnostic panel, and no section vocabulary on the surface. They
 *    are `typo-eyebrow` now, which exists for exactly this job.
 *  - the phase/state separator was `opacity-40`, i.e. the type scale's job done
 *    by transparency. It is a tokenised ink now.
 *  - the head's phase line, its tally and the binding details were all
 *    `typo-caption text-foreground` - four identical lines, so the tally (a
 *    figure) read exactly like the phase (a category). The tally is `typo-data`
 *    with tabular figures, the phase is meta ink, and the state word carries the
 *    one emphasis.
 */
import { useEffect } from 'react';

import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';

import { bindingKindLabel, bindingStateLabel, stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { NODE_MARK, STATE_CHIP, STATE_TEXT } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';
import { useSkin } from '../skins';

export function StepState() {
  const { dl, tx, selected } = useLifecycleViewModel();
  const skin = useSkin();
  const label = selected ? stepLabel(dl, selected.id, selected.label) : null;

  useEffect(() => {
    if (!selected || !label) return;
    announceImperative(tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, selected.strongestState) }));
  }, [selected, label, tx, dl]);

  if (!selected || !label) return null;
  const Glyph = stepGlyph(selected.id);
  const state = selected.strongestState;

  return (
    <div className={skin.panelWrap} data-testid="lc-step-state">
      <header className={skin.panelHead}>
        <span
          className={`${skin.panelGlyph} flex items-center justify-center shrink-0 ${NODE_MARK[skin.nodeMark][state]}`}
        >
          <Glyph className={`w-4 h-4 ${STATE_TEXT[state]}`} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={`${skin.panelTitle} truncate`}>{label}</h3>
          <p className={skin.panelMeta}>
            {selected.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}
            <span aria-hidden className="mx-1.5">/</span>
            <span className={`font-semibold ${STATE_TEXT[state]}`}>{bindingStateLabel(dl, state)}</span>
          </p>
        </div>
        <span className={`${skin.panelTally} shrink-0 text-right`}>
          {tx(dl.lc_detail_tally, {
            done: selected.tally.done, skipped: selected.tally.skipped,
            unknown: selected.tally.unknown, failed: selected.tally.failed,
          })}
        </span>
      </header>

      <div className={skin.panelBody}>
        <section className="min-w-0 space-y-1.5">
          <h4 className={skin.sectionHead}>{dl.lc_detail_rule}</h4>
          <p className={skin.ruleText}>{selected.rule}</p>
        </section>

        <section className="min-w-0 space-y-1.5">
          <h4 className={skin.sectionHead}>{dl.lc_detail_bindings}</h4>
          {selected.view.bindingViews.length === 0 && (
            <p className="typo-caption">{dl.lc_state_phrase_advisory}</p>
          )}
          <ul className={`${skin.bindingList} empty:hidden`}>
            {selected.view.bindingViews.map((b) => (
              <li key={b.kind} className={skin.bindingRow}>
                <span className={`mt-0.5 shrink-0 ${skin.bindingChip} ${STATE_CHIP[b.state]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={skin.bindingKind}>
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

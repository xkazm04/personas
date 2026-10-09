/**
 * The peek's lower half: the step's recent outcomes and what enforces it.
 *
 * The outcomes were 6px beads under every collar on layer one, unreadable at
 * that size and redundant with the figure (an evidence step's figure IS its
 * done rate over the same changes). Here they are labelled marks - each
 * outcome's own glyph in its own ink (`OUTCOME_LOOK`), oldest left, newest
 * right - with the count of each outcome in words beside them.
 */
import { outcomeLabel, bindingKindLabel } from '../../../journey/journeyLabels';
import { useLifecycleViewModel } from '../../context';
import { OUTCOMES } from '../../railShared';
import { LT } from '../../system/lcType';
import { BindingPill } from '../../system/Pill';
import { OUTCOME_LOOK, PILL_TONE } from '../../system/pillLooks';
import { GLYPH } from '../../system/scales';
import type { HealthStep } from '../healthModel';

export function PeekEvidence({ step }: { step: HealthStep }) {
  const { dl, tx } = useLifecycleViewModel();
  const { node } = step;
  const counts = OUTCOMES.map((o) => ({ o, n: node.dots.filter((d) => d.outcome === o).length })).filter((c) => c.n > 0);
  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <>
      {node.dots.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={LT.label}>{dl.lcx2_peek_recent}</span>
          <span role="img" aria-label={summary} className="inline-flex items-center gap-0.5" data-testid={`lc-dots-${node.id}`}>
            {node.dots.map((d) => {
              const look = OUTCOME_LOOK[d.outcome];
              const Glyph = look.glyph;
              return (
                <Glyph
                  key={`${d.sourceKind}:${d.sourceRef}`}
                  className={`${GLYPH.sm} ${PILL_TONE[look.tone].ink}`}
                  data-outcome={d.outcome}
                  aria-hidden
                />
              );
            })}
          </span>
          <span className={LT.meta}>
            {counts.map((c) => tx(dl.lcx2_peek_outcome_count, { count: c.n, outcome: outcomeLabel(dl, c.o) })).join(', ')}
          </span>
        </div>
      )}
      {node.view.bindingViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={LT.label}>{dl.lcx2_peek_enforced}</span>
          {node.view.bindingViews.map((b) => (
            <span key={b.kind} className="inline-flex items-center gap-1.5">
              <span className={LT.row}>{bindingKindLabel(dl, b.kind)}</span>
              <BindingPill state={b.state} />
            </span>
          ))}
        </div>
      )}
    </>
  );
}

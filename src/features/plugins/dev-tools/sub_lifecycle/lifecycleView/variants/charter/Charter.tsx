/**
 * CHARTER - the lifecycle as the DOCUMENT it actually is.
 *
 * The bet: a project's practice is a set of rules an agent is handed, and the
 * first thing the operator needs is to READ them. Everywhere else in the app the
 * rule text is behind a selection, one step at a time, so the one artefact the
 * surface exists to govern has never been readable in one pass. Here the whole
 * charter is on screen as a two-page folio - "Before the task" is the left page,
 * "After the task" the right - with each clause numbered in journey order and
 * its enforcement annotated in its own margin.
 *
 * Levels, not one layer: the article column is a reading surface at the repo's
 * reading tier, the margin is an annotation column, and the evidence is a third
 * surface in a reserved well at the foot. The folio is what keeps the reading
 * from becoming an 1100px scroll - eleven clauses in one column is a document
 * nobody finishes; six and five side by side is a spread.
 *
 * Position in the sequence is carried by the ordinal and the page, not by a
 * drawn path. That is the trade this concept makes on purpose, and the rail
 * beside it is the control for whether it was worth it.
 */
import { stepLabel } from '../../../journey/journeyLabels';
import { STATE_TEXT } from '../../../journey/journeyStyles';
import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { EvidenceLedger } from '../../blocks/EvidenceLedger';
import { LifecycleActions } from '../../blocks/LifecycleActions';
import { StateLegend } from '../../blocks/StateLegend';
import { useStepRoving } from '../../blocks/useStepRoving';
import { CharterArticle } from './CharterArticle';
import { CharterGhost } from './CharterGhost';

const PLATE = 'rounded-card border border-primary/15 bg-primary/[0.02]';

export function Charter() {
  const { dl, headline, headlineState, lanes, order, selected, select, loading } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);
  const ink = headlineState ? STATE_TEXT[headlineState] : 'text-foreground';

  const page = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <section role="group" aria-label={title} className="min-w-0 space-y-2" data-testid={testId}>
      <h3 className="typo-eyebrow text-primary/80">{title}</h3>
      {nodes.map((node, i) => (
        <CharterArticle
          key={node.id}
          node={node}
          ordinal={offset + i + 1}
          index={offset + i}
          tabIndex={offset + i === activeIndex ? 0 : -1}
          bindRef={bind(offset + i)}
        />
      ))}
    </section>
  );

  return (
    <div className="space-y-4 pb-6" data-testid="lc-journey">
      <LifecycleActions />

      <section className={`${PLATE} p-5 space-y-4`}>
        <header className="space-y-1 border-b border-primary/10 pb-3">
          <h2 className="typo-section-title">{dl.lc_journey_label}</h2>
          <p className={`typo-body-lg ${ink}`} data-testid="lc-weakest">{headline}</p>
        </header>

        {order.length > 0 ? (
          <div
            role="toolbar"
            aria-orientation="vertical"
            aria-label={dl.lc_journey_label}
            onKeyDown={onKeyDown}
            className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4 items-start"
            data-testid="lc-journey-track"
          >
            {page(dl.lc_lane_before, lanes.before, 0, 'lc-lane-before')}
            {page(dl.lc_lane_after, lanes.after, lanes.before.length, 'lc-lane-after')}
          </div>
        ) : loading ? <CharterGhost /> : null}

        <footer className="border-t border-primary/10 pt-3">
          <StateLegend />
        </footer>
      </section>

      <section className={`${PLATE} p-4 space-y-2 min-h-[16rem]`} data-testid="lc-state-region">
        <header className="flex items-baseline gap-3 min-w-0">
          <h3 className="typo-eyebrow text-foreground shrink-0">{dl.lc_detail_evidence}</h3>
          {selected && (
            <span className="typo-title-lg truncate">{stepLabel(dl, selected.id, selected.label)}</span>
          )}
        </header>
        <div className="h-[13rem]">
          <EvidenceLedger />
        </div>
      </section>
    </div>
  );
}

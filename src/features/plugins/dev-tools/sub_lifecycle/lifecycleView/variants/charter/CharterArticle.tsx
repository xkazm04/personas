/**
 * One ARTICLE of the charter: a numbered clause on the reading line, the rule
 * text the agent is actually given, and - in its own margin beside the prose -
 * what enforces it.
 *
 * Two levels, spatially separated rather than stacked in one rectangle: the
 * article column is a reading surface (`typo-body-lg`, the repo's reading tier,
 * leading relaxed) and the margin is an annotation column at a smaller tier. The
 * rule text is the one thing this container puts on screen that no other
 * container does: everywhere else in the app it is visible one step at a time,
 * behind a selection, and a practice whose rules you cannot read is a practice
 * you cannot audit.
 *
 * The clause head is ONE type tier whether or not it is selected. The rail that
 * replaced this surface's old skin round had the opposite defect - selecting a
 * node changed its caption's tier, so arrow-walking made the whole row jump -
 * and a tier that grows on selection is the same bug wearing the other sign.
 * Selection is the lit spine, the wash and `aria-pressed`.
 *
 * The ORDINAL is the control, not the prose. A paragraph wrapped in a button
 * cannot be selected with the mouse and reads as a link; a clause number is a
 * thing you point at, it is 11 characters wide at every window size, and it
 * leaves the prose inert. `aria-pressed` and the testid stay on it, so the
 * roving-keyboard model and the surface's tests are the shared ones.
 */
import { Button } from '@/features/shared/components/buttons';

import { bindingKindLabel, bindingStateLabel, stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import { STATE_CHIP, STATE_TEXT } from '../../../journey/journeyStyles';
import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { EvidenceDots } from '../../blocks/EvidenceDots';

export interface CharterArticleProps {
  node: JourneyNode;
  /** 1-based position in the whole journey, both lanes counted. */
  ordinal: number;
  index: number;
  tabIndex: number;
  bindRef: (el: HTMLButtonElement | null) => void;
}

export function CharterArticle({ node, ordinal, index, tabIndex, bindRef }: CharterArticleProps) {
  const { dl, tx, selected, select } = useLifecycleViewModel();
  const label = stepLabel(dl, node.id, node.label);
  const Glyph = stepGlyph(node.id);
  const state = node.strongestState;
  const on = node.id === selected?.id;

  return (
    <article
      className={`grid grid-cols-1 lg:grid-cols-[1fr_8.5rem] gap-x-5 gap-y-2 border-l-2 pl-4 py-3 ${
        on ? 'border-l-primary bg-primary/[0.05]' : 'border-l-primary/15'
      }`}
      data-selected={on ? 'true' : undefined}
    >
      <div className="min-w-0 space-y-1.5">
        <Button
          ref={bindRef}
          variant="ghost"
          size="sm"
          tabIndex={tabIndex}
          aria-pressed={on}
          onClick={() => select(node.id)}
          aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, state) })}
          data-testid={`lc-node-${node.id}`}
          data-state={state}
          data-selected={on ? 'true' : undefined}
          data-index={index}
          className="-ml-2 gap-2.5"
        >
          <span className="typo-data tabular-nums text-primary">
            {String(ordinal).padStart(2, '0')}
          </span>
          <Glyph className={`w-4 h-4 shrink-0 ${STATE_TEXT[state]}`} aria-hidden />
          <span className="typo-title-lg">{label}</span>
        </Button>
        <p className="typo-body-lg text-foreground leading-relaxed">{node.rule}</p>
      </div>

      <aside className="min-w-0 space-y-1.5 lg:border-l lg:border-primary/10 lg:pl-4">
        {node.view.bindingViews.length === 0 ? (
          <p className="typo-caption">{dl.lc_state_phrase_advisory}</p>
        ) : (
          node.view.bindingViews.map((b) => (
            <p key={b.kind} className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 w-4 h-4 rounded-interactive ${STATE_CHIP[b.state]}`} aria-hidden />
              <span className="typo-caption truncate">{bindingKindLabel(dl, b.kind)}</span>
              <span className={`typo-label truncate ${STATE_TEXT[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
            </p>
          ))
        )}
        <EvidenceDots node={node} />
      </aside>
    </article>
  );
}

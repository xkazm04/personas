/**
 * One step on the rail as ONE object: a card holding the step's key (its
 * binding on the cap's strip) and name, its figure with the change since the
 * earlier measure, the meter the pipe runs through, and the verdict (glyph and
 * words) with what it was. Five fixed rows (`cardRows`), so
 * every card in a lane is the same height whatever its verdict.
 *
 * The card's outline is the verdict's stroke (solid, dashed for not measured,
 * dotted for stale, a quiet line for instructed) over its wash. Selection RAISES
 * the card (elevation + ring), never reflows it. Under a verdict highlight a
 * card outside it dims its SURFACE (outline, wash, depth) and its drawing;
 * its text keeps full contrast. Viewing a past Measure (`history/timeTravel`),
 * Gate and Tests show that Measure and carry the history glyph by their name;
 * every step the history does not track dims the same way.
 *
 * The whole card is one press target (the key's stretched hit area); the key
 * is the tab stop. Resting on the card, or focusing its key, opens the peek.
 */
import { motion } from 'framer-motion';
import { History } from 'lucide-react';

import { stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import type { StepRoving } from '../../blocks/useStepRoving';
import { useLifecycleViewModel } from '../../context';
import { isUntracked, useTimeTravel } from '../../history/timeTravel';
import { enterDelay } from '../../railShared';
import { useEntrance } from '../../system/entrance';
import { lcShape, lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { KeyCap } from '../../TactileKeys';
import { stepChange } from '../delta';
import { VERDICT, type HealthStep } from '../healthModel';
import { highlightOf, useHighlight } from '../highlight';
import { HEALTH_GLYPH, healthLabel } from '../layer1Labels';
import { StepPress } from '../parts/StepPress';
import { CardFigure } from './CardFigure';
import { CARD_ROW, CARD_ROW_GAP } from './cardRows';
import { Pipe } from './Pipe';
import type { PeekControl } from './usePeek';

interface NodeCardProps {
  step: HealthStep;
  /** The upstream card in the same lane; null for a lane's first card. */
  upstream: HealthStep | null;
  index: number;
  roving: StepRoving;
  peek: PeekControl;
}

export function NodeCard({ step, upstream, index, roving, peek }: NodeCardProps) {
  const { dl, tx, selected } = useLifecycleViewModel();
  const entering = useEntrance();
  const { active } = useHighlight();
  const { node } = step;
  const on = node.id === selected?.id;
  const lit = highlightOf(active, step.health);
  const travel = useTimeTravel();
  // Viewing a past Measure: a step the history does not track is drawn as it is now, dimmed.
  const untracked = isUntracked(travel, node.id);
  const then = travel.viewing !== null && !untracked;
  const dim = lit === 'off' || untracked;
  const v = VERDICT[step.health];
  const change = stepChange(step);
  const Glyph = stepGlyph(node.id);
  const VerdictGlyph = HEALTH_GLYPH[step.health];
  // Every card's outline is 2px, so its rows (and the pipe's line) sit at the same
  // place in every card; an instructed card keeps its quiet colour at that width.
  const outline = step.health === 'instructed' ? 'border-2 border-solid border-primary/15' : v.outline;
  const surface = dim ? 'border-2 border-primary/10 shadow-none' : `${outline} shadow-elevation-1`;
  const raise = on ? '-translate-y-0.5 shadow-elevation-3 ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : '';
  return (
    <motion.li
      className={`@container/card relative isolate flex min-w-0 flex-col ${CARD_ROW_GAP} transition-[box-shadow,transform,border-color] duration-200 motion-reduce:transition-none ${lcSurface('node', `bg-background ${surface}`)} ${raise}`}
      initial={entering ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32, delay: enterDelay(index, 0.04) }}
      onPointerEnter={(e) => peek.show(step, e.currentTarget)}
      onPointerLeave={peek.hide}
      onFocus={(e) => peek.show(step, e.currentTarget)}
      onBlur={peek.hide}
      data-selected={on || undefined}
      data-highlight={lit}
      data-travel={untracked ? 'untracked' : then ? 'then' : undefined}
      data-card={node.id}
    >
      <span aria-hidden className={`pointer-events-none absolute inset-0 -z-10 ${lcShape('node')} ${v.wash} transition-opacity duration-200 motion-reduce:transition-none ${dim ? 'opacity-0' : 'opacity-100'}`} />
      <div className={CARD_ROW.head} data-row="head">
        <StepPress step={step} index={index} roving={roving} size="icon-sm">
          <KeyCap state={node.strongestState} pressed={on} size="sm">
            <Glyph className={`${GLYPH.sm} ${v.ink}`} aria-hidden />
          </KeyCap>
        </StepPress>
        <span className={`min-w-0 flex-1 truncate ${LT.title} ${on ? 'text-primary' : ''}`}>
          {stepLabel(dl, node.id, node.label)}
        </span>
        {then && <History className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden data-then />}
      </div>
      <CardFigure
        step={step}
        change={change}
        dim={dim}
        pipe={upstream ? <Pipe downstream={step.health} upstream={upstream.health} dim={dim} /> : null}
      />
      <div className={CARD_ROW.verdict} data-row="verdict" data-testid={`lc1-verdict-${node.id}`}>
        <VerdictGlyph className={`${GLYPH.sm} shrink-0 ${v.ink}`} aria-hidden />
        {/* On a narrow card a changed verdict keeps its glyph and says what it WAS;
            the word for what it is returns when the card has room. */}
        <span className={`shrink-0 ${v.ink} ${change?.was ? 'hidden @[11.5rem]/card:inline' : ''}`}>{healthLabel(dl, step.health)}</span>
        {change?.was && (
          <span className="min-w-0 truncate" data-was={change.was}>
            {tx(dl.lcx2_was, { verdict: healthLabel(dl, change.was) })}
          </span>
        )}
      </div>
    </motion.li>
  );
}

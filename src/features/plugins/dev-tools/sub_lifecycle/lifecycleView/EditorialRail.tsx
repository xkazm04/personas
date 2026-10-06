/**
 * VARIANT 2 (Editorial) - the rail as a table of contents. Same two lanes, same
 * order, same roving keyboard and selection as `blocks/StepRail`; the node is
 * redesigned as a NUMBERED ENTRY:
 *
 * - a two-digit ordinal set as a figure (the journey's order made legible: "07"
 *   tells you where you are without counting nodes);
 * - glyph and name set small beneath it, and the binding state as the entry's
 *   underline on the stroke ladder - a rule, not a box;
 * - evidence as a line of printer's marks (`OutcomeMark`);
 * - the lanes are headed like sections and parted by a hairline column rule.
 *
 * Motion: entries fade up once in reading order and their underlines draw left
 * to right after them; the selection is a highlighter swatch that slides between
 * entries (`layoutId`) only when the user moves it.
 */
import { motion } from 'framer-motion';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';

import { bindingStateLabel, outcomeLabel, stepGlyph, stepLabel } from '../journey/journeyLabels';
import { STATE_TEXT } from '../journey/journeyStyles';
import type { JourneyNode } from '../journey/journeyModel';
import { useLifecycleViewModel } from './context';
import { useStepRoving } from './blocks/useStepRoving';
import { OutcomeMark, UNDERLINE } from './EditorialMarks';
import { enterDelay } from './variantShared';

function MarkLine({ node }: { node: JourneyNode }) {
  const { dl, tx } = useLifecycleViewModel();
  if (node.dots.length === 0) return <span className="h-2" aria-hidden />;
  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <span role="img" aria-label={summary} className="flex h-2 items-center gap-0.5" data-testid={`lc-dots-${node.id}`}>
      {node.dots.map((d) => <OutcomeMark key={`${d.sourceKind}:${d.sourceRef}`} outcome={d.outcome} />)}
    </span>
  );
}

export function EditorialRail() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const renderNode = (node: JourneyNode, index: number) => {
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const on = node.id === selected?.id;
    const state = node.strongestState;
    return (
      <motion.li
        key={node.id}
        className="w-20 flex flex-col items-center gap-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: enterDelay(index, 0.04) }}
      >
        <Button
          ref={bind(index)}
          variant="ghost"
          size="sm"
          tabIndex={index === activeIndex ? 0 : -1}
          aria-pressed={on}
          onClick={() => select(node.id)}
          aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, state) })}
          data-testid={`lc-node-${node.id}`}
          data-state={state}
          className="relative w-full h-auto justify-center overflow-hidden px-1 py-2 rounded-card"
        >
          {on && (
            <motion.span
              layoutId="lc-v2-highlight"
              aria-hidden
              className="absolute inset-0 rounded-card bg-primary/10"
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            />
          )}
          <span className="relative flex flex-col items-center gap-1">
            <Numeric className={`typo-data-lg ${on ? STATE_TEXT[state] : 'text-foreground'}`}>
              {String(index + 1).padStart(2, '0')}
            </Numeric>
            <span className="flex max-w-full items-center gap-1">
              <Glyph className={`w-3.5 h-3.5 shrink-0 ${STATE_TEXT[state]}`} aria-hidden />
              <span className={`truncate typo-caption ${on ? 'font-semibold text-foreground' : ''}`}>{label}</span>
            </span>
            <motion.span
              aria-hidden
              className={`block w-10 origin-left ${UNDERLINE[state]}`}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.35, delay: enterDelay(index, 0.04, 0.25) }}
            />
          </span>
        </Button>
        <MarkLine node={node} />
      </motion.li>
    );
  };

  const renderLane = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <div role="group" aria-label={title} className="flex flex-col gap-3 shrink-0" data-testid={testId}>
      <div className="flex items-baseline gap-2 border-b border-primary/15 pb-1.5 px-1">
        <span className="typo-heading text-foreground">{title}</span>
        <Numeric value={nodes.length} className="typo-caption" />
      </div>
      <ol className="flex items-start gap-1">{nodes.map((n, i) => renderNode(n, offset + i))}</ol>
    </div>
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={dl.lc_journey_label}
        onKeyDown={onKeyDown}
        className="flex w-max mx-auto items-stretch gap-6 px-2"
        data-testid="lc-journey-track"
      >
        {renderLane(dl.lc_lane_before, lanes.before, 0, 'lc-lane-before')}
        <span aria-hidden className="w-px self-stretch bg-primary/15" />
        {renderLane(dl.lc_lane_after, lanes.after, lanes.before.length, 'lc-lane-after')}
      </div>
    </div>
  );
}

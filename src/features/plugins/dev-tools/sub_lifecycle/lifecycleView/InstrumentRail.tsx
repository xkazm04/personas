/**
 * VARIANT 1 (Instrument) - the rail. Same two lanes, same order, same roving
 * keyboard and selection as `blocks/StepRail`; what changed is the node and its
 * furniture:
 *
 * - each node is an `OutcomeDial` (evidence split as arcs inside the state ring),
 *   so a step's follow-through is readable on the rail without selecting it;
 * - the evidence dots become a TICK TRACE: bar height encodes outcome (done and
 *   failed full, skipped half, unknown a stub), so the eye reads a waveform
 *   rather than counting fills;
 * - the selection is a CURSOR under the node that glides between steps
 *   (`layoutId`), instead of a ring that blinks from one node to the next;
 * - each lane head carries its step count on a ruled scale line.
 *
 * Motion: nodes rise in once, left to right; dial arcs sweep after them; ticks
 * grow from the baseline. All one-shot; the cursor moves only when the user
 * moves the selection.
 */
import { motion } from 'framer-motion';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { bindingStateLabel, outcomeLabel, stepGlyph, stepLabel } from '../journey/journeyLabels';
import { STATE_TEXT } from '../journey/journeyStyles';
import type { JourneyNode } from '../journey/journeyModel';
import { useLifecycleViewModel } from './context';
import { useStepRoving } from './blocks/useStepRoving';
import { OutcomeDial } from './InstrumentDial';
import { enterDelay } from './variantShared';

const SEG = 'absolute top-1/2 -translate-y-1/2 h-px bg-primary/25';

/** Tick height by outcome: a waveform you read by silhouette, not by counting fills. */
export const TICK: Record<LifecycleOutcome, string> = {
  done: 'h-3 bg-status-success',
  failed: 'h-3 bg-status-error',
  skipped: 'h-1.5 bg-status-warning',
  unknown: 'h-0.5 bg-primary/30',
};

function TickTrace({ node, delay }: { node: JourneyNode; delay: number }) {
  const { dl, tx } = useLifecycleViewModel();
  if (node.dots.length === 0) return <span className="h-3" aria-hidden />;
  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <span role="img" aria-label={summary} className="flex h-3 items-end gap-0.5" data-testid={`lc-dots-${node.id}`}>
      {node.dots.map((d, j) => (
        <motion.span
          key={`${d.sourceKind}:${d.sourceRef}`}
          data-outcome={d.outcome}
          className={`block w-1 origin-bottom ${TICK[d.outcome]}`}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.22, delay: delay + j * 0.02 }}
        />
      ))}
    </span>
  );
}

export function InstrumentRail() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const renderNode = (node: JourneyNode, index: number, first: boolean, last: boolean) => {
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const on = node.id === selected?.id;
    return (
      <motion.li
        key={node.id}
        className="w-20 flex flex-col items-center gap-1.5"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: enterDelay(index) }}
      >
        <span className="relative flex h-11 w-full items-center justify-center">
          {!first && <span aria-hidden className={`${SEG} -left-1 right-1/2`} />}
          {!last && <span aria-hidden className={`${SEG} left-1/2 -right-1`} />}
          <span className="relative z-10 rounded-full bg-background">
            <Button
              ref={bind(index)}
              variant="ghost"
              size="icon-lg"
              tabIndex={index === activeIndex ? 0 : -1}
              aria-pressed={on}
              onClick={() => select(node.id)}
              aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, node.strongestState) })}
              data-testid={`lc-node-${node.id}`}
              data-state={node.strongestState}
              className="rounded-full"
            >
              <OutcomeDial tally={node.tally} state={node.strongestState} size={44} delay={enterDelay(index, 0.035, 0.2)}>
                <Glyph className={`w-4 h-4 ${STATE_TEXT[node.strongestState]}`} aria-hidden />
              </OutcomeDial>
            </Button>
          </span>
        </span>
        <span className="flex h-1 w-full justify-center" aria-hidden>
          {on && (
            <motion.span
              layoutId="lc-v1-cursor"
              className="block h-0.5 w-8 rounded-full bg-primary"
              transition={{ type: 'spring', stiffness: 520, damping: 40 }}
            />
          )}
        </span>
        <span className={`max-w-full truncate text-center typo-caption ${on ? 'font-semibold text-foreground' : ''}`}>
          {label}
        </span>
        <TickTrace node={node} delay={enterDelay(index, 0.035, 0.3)} />
      </motion.li>
    );
  };

  const renderLane = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <div role="group" aria-label={title} className="flex flex-col gap-3 shrink-0" data-testid={testId}>
      <div className="flex items-center gap-2 px-1">
        <span className="typo-eyebrow text-primary">{title}</span>
        <Numeric value={nodes.length} className="typo-caption" />
        <span aria-hidden className="h-px flex-1 bg-primary/20" />
      </div>
      <ol className="flex items-start gap-2">
        {nodes.map((n, i) => renderNode(n, offset + i, i === 0, i === nodes.length - 1))}
      </ol>
    </div>
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={dl.lc_journey_label}
        onKeyDown={onKeyDown}
        className="flex w-max mx-auto items-start gap-10 px-2"
        data-testid="lc-journey-track"
      >
        {renderLane(dl.lc_lane_before, lanes.before, 0, 'lc-lane-before')}
        {renderLane(dl.lc_lane_after, lanes.after, lanes.before.length, 'lc-lane-after')}
      </div>
    </div>
  );
}

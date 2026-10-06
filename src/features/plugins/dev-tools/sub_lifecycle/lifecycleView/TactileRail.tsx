/**
 * VARIANT 3 (Tactile) - the rail as a keyboard. Same two lanes, same order,
 * same roving keyboard and selection as `blocks/StepRail`; redesigned parts:
 *
 * - each lane is a recessed TRAY with its title stamped on the lip, and the
 *   steps run along a groove inside it;
 * - each node is a `KeyCap` with its state on the indicator strip; the selected
 *   key is the one that is SEATED (pressed in), so the selection reads as a
 *   physical position rather than a ring drawn around a box;
 * - evidence is a `BeadTrack`.
 *
 * Motion: keys drop into the tray once on mount, left to right; beads pop into
 * their slot after them; selecting seats the new key and releases the old one
 * with a spring. Nothing moves on hover, nothing moves on its own.
 */
import { motion } from 'framer-motion';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';

import { bindingStateLabel, outcomeLabel, stepGlyph, stepLabel } from '../journey/journeyLabels';
import { STATE_TEXT } from '../journey/journeyStyles';
import type { JourneyNode } from '../journey/journeyModel';
import { useLifecycleViewModel } from './context';
import { useStepRoving } from './blocks/useStepRoving';
import { BeadTrack, KeyCap } from './TactileKeys';
import { enterDelay } from './railShared';

const GROOVE = 'absolute top-1/2 -translate-y-1/2 h-0.5 bg-primary/15';

function Beads({ node, delay }: { node: JourneyNode; delay: number }) {
  const { dl, tx } = useLifecycleViewModel();
  if (node.dots.length === 0) return <span className="h-3" aria-hidden />;
  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <span role="img" aria-label={summary} data-testid={`lc-dots-${node.id}`}>
      <BeadTrack beads={node.dots.map((d) => ({ key: `${d.sourceKind}:${d.sourceRef}`, outcome: d.outcome }))} delay={delay} />
    </span>
  );
}

export function TactileRail() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const renderNode = (node: JourneyNode, index: number, first: boolean, last: boolean) => {
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const on = node.id === selected?.id;
    return (
      <motion.li
        key={node.id}
        className="w-20 flex flex-col items-center gap-2"
        initial={{ opacity: 0, y: -6, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30, delay: enterDelay(index, 0.04) }}
      >
        <span className="relative flex h-11 w-full items-center justify-center">
          {!first && <span aria-hidden className={`${GROOVE} -left-1 right-1/2`} />}
          {!last && <span aria-hidden className={`${GROOVE} left-1/2 -right-1`} />}
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
            className="relative z-10 hover:bg-transparent"
          >
            <KeyCap state={node.strongestState} pressed={on}>
              <Glyph className={`w-4 h-4 ${STATE_TEXT[node.strongestState]}`} aria-hidden />
            </KeyCap>
          </Button>
        </span>
        <span className={`max-w-full truncate text-center typo-caption ${on ? 'font-semibold text-foreground' : ''}`}>
          {label}
        </span>
        <Beads node={node} delay={enterDelay(index, 0.04, 0.3)} />
      </motion.li>
    );
  };

  const renderLane = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <div
      role="group"
      aria-label={title}
      className="flex flex-col gap-2.5 shrink-0 rounded-modal border border-primary/10 bg-secondary/30 px-3 pt-2.5 pb-3 shadow-inner"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="typo-eyebrow text-primary">{title}</span>
        <Numeric value={nodes.length} className="typo-caption rounded-full bg-background px-1.5 shadow-elevation-1" />
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
        className="flex w-max mx-auto items-start gap-6 px-2"
        data-testid="lc-journey-track"
      >
        {renderLane(dl.lc_lane_before, lanes.before, 0, 'lc-lane-before')}
        {renderLane(dl.lc_lane_after, lanes.after, lanes.before.length, 'lc-lane-after')}
      </div>
    </div>
  );
}

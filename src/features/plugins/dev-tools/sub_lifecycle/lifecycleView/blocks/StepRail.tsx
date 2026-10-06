/**
 * The horizontal two-lane rail: "Before the task" and "After the task" joined
 * by one path line through every node. A node is the step's glyph inside a
 * shape whose border encodes its strongest binding state (shape AND colour, so
 * it survives colour-blindness), with up to eight evidence dots under it,
 * newest on the right.
 *
 * Carried over from the retired `journey/JourneyTrack` with one change that is
 * the whole point of this round: a node no longer OPENS anything. It SELECTS,
 * and the selected node is marked (`aria-pressed`, a ring) so the rail reads as
 * a control for the state region below it rather than a row of buttons that
 * each summon a drawer.
 *
 * Keyboard: one tab stop; arrows / Home / End move the roving focus and select
 * as they go, so holding an arrow key walks the state region through the journey.
 */
import { Button } from '@/features/shared/components/buttons';

import { bindingStateLabel, stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { STATE_SHAPE, STATE_TEXT } from '../../journey/journeyStyles';
import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { EvidenceDots } from './EvidenceDots';
import { useStepRoving } from './useStepRoving';

export function StepRail() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const renderNode = (node: JourneyNode, index: number) => {
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const isSelected = node.id === selected?.id;
    return (
      <li key={node.id} className="w-20 flex flex-col items-center gap-2">
        {/* Opaque backing so the path line never shows through the tinted node. */}
        <span className="relative z-10 rounded-modal bg-background">
          <Button
            ref={bind(index)}
            variant="ghost"
            size="icon-lg"
            tabIndex={index === activeIndex ? 0 : -1}
            aria-pressed={isSelected}
            onClick={() => select(node.id)}
            aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, node.strongestState) })}
            data-testid={`lc-node-${node.id}`}
            data-state={node.strongestState}
            data-selected={isSelected ? 'true' : undefined}
            className={`${STATE_SHAPE[node.strongestState]} ${isSelected ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : ''}`}
            icon={<Glyph className={`w-5 h-5 ${STATE_TEXT[node.strongestState]}`} aria-hidden />}
          />
        </span>
        <span className={`text-center truncate max-w-full ${isSelected ? 'typo-label text-primary' : 'typo-caption text-foreground'}`}>
          {label}
        </span>
        <EvidenceDots node={node} />
      </li>
    );
  };

  const renderLane = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <div role="group" aria-label={title} className="flex flex-col gap-3 shrink-0" data-testid={testId}>
      <span className="typo-card-label text-foreground px-1 h-5 whitespace-nowrap">{title}</span>
      <ol className="flex items-start gap-2">{nodes.map((n, i) => renderNode(n, offset + i))}</ol>
    </div>
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={dl.lc_journey_label}
        onKeyDown={onKeyDown}
        className="relative flex w-max mx-auto items-start gap-8 px-2"
        data-testid="lc-journey-track"
      >
        {/* The single path line through every node centre: lane title (h-5, 20px) + gap-3 (12px) + half a node (icon-lg, 22px) = 54px. */}
        <span aria-hidden className="absolute left-12 right-12 top-[3.375rem] h-px bg-primary/25" />
        {renderLane(dl.lc_lane_before, lanes.before, 0, 'lc-lane-before')}
        {renderLane(dl.lc_lane_after, lanes.after, lanes.before.length, 'lc-lane-after')}
      </div>
    </div>
  );
}

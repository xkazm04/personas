/**
 * The horizontal two-lane rail: "Before the task" and "After the task", each
 * lane a run of nodes joined by one path line. A node is the step's glyph inside
 * a shape whose stroke encodes its strongest binding state (style AND width, so
 * it survives colour-blindness), with up to eight evidence dots under it,
 * newest on the right.
 *
 * A node does not OPEN anything. It SELECTS, and the selected node is marked
 * (`aria-pressed`, a ring) so the rail reads as a control for the state region
 * below it. Keyboard: one tab stop; arrows / Home / End move the roving focus
 * and select as they go, so holding an arrow key walks the state region through
 * the journey.
 *
 * Two defects of the version this replaces:
 *
 * 1. The path line was ONE absolutely-positioned span across the whole rail at
 *    `top-[3.375rem]`, a hand-summed constant (lane head 20px + gap 12px + half
 *    a 44px node) that the comment beside it had to derive. Any change to the
 *    head's type, the gap or the node size silently detached the line from the
 *    node centres - and it is why the lane head carried a magic `h-5`. The line
 *    is drawn as two half-segments INSIDE each node's own 44px box at
 *    `top-1/2`, so it is centred on the node by construction, needs no constant,
 *    and stops at each lane's edge - which makes the before/after split visible
 *    instead of a `role="group"` only a screen reader can perceive.
 *
 * 2. Selecting a node SHRANK its caption: selected was `typo-label` (--type-0)
 *    against `typo-caption` (--type-1) unselected, so emphasis was a step DOWN
 *    and arrow-walking the rail made the whole caption row jump. Both states are
 *    one type step and the difference is weight (400 -> 600) plus the tint,
 *    which is the only real weight step this font has.
 */
import { Button } from '@/features/shared/components/buttons';

import { bindingStateLabel, stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { STATE_MARK, STATE_TEXT } from '../../journey/journeyStyles';
import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { EvidenceDots } from './EvidenceDots';
import { useStepRoving } from './useStepRoving';

/** The node box: `icon-lg` is 44px, and the connector is centred in it. */
const NODE_BOX = 'relative flex h-11 w-full items-center justify-center';
/** Half a path line. The negative inset closes the `gap-2` between two nodes. */
const SEG = 'absolute top-1/2 -translate-y-1/2 bg-primary/25 h-px';

export function StepRail() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const renderNode = (node: JourneyNode, index: number, first: boolean, last: boolean) => {
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const on = node.id === selected?.id;
    return (
      <li key={node.id} className="w-20 flex flex-col items-center gap-2">
        <span className={NODE_BOX}>
          {!first && <span aria-hidden className={`${SEG} -left-1 right-1/2`} />}
          {!last && <span aria-hidden className={`${SEG} left-1/2 -right-1`} />}
          {/* Opaque backing so the path line never shows through the node. */}
          <span className="relative z-10 rounded-modal bg-background">
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
              data-selected={on ? 'true' : undefined}
              className={`${STATE_MARK[node.strongestState]} ${
                on ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : ''
              }`}
              icon={<Glyph className={`w-5 h-5 ${STATE_TEXT[node.strongestState]}`} aria-hidden />}
            />
          </span>
        </span>
        <span
          className={`text-center truncate max-w-full typo-caption ${on ? 'font-semibold text-primary' : ''}`}
        >
          {label}
        </span>
        <EvidenceDots node={node} />
      </li>
    );
  };

  const renderLane = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <div role="group" aria-label={title} className="flex flex-col gap-2.5 shrink-0" data-testid={testId}>
      <span className="typo-eyebrow text-primary/80">{title}</span>
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

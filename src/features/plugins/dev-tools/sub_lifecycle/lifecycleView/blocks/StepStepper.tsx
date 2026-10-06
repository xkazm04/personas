/**
 * The vertical stepper: the journey as a single descending column, phases as
 * two headed groups, each step a full row carrying its glyph, label, state word
 * and recent dots. Its reason to exist is that a vertical timeline is NARROW,
 * which frees the whole right-hand side for the state panel and the ledger at
 * full height - no vertical travel between the thing you clicked and the thing
 * it explains.
 */
import { Button } from '@/features/shared/components/buttons';

import { bindingStateLabel, stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { STATE_SHAPE, STATE_TEXT } from '../../journey/journeyStyles';
import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { EvidenceDots } from './EvidenceDots';
import { useStepRoving } from './useStepRoving';

export function StepStepper() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const row = (node: JourneyNode, index: number) => {
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const isSelected = node.id === selected?.id;
    return (
      <li key={node.id}>
        <Button
          variant="ghost"
          size="sm"
          ref={bind(index)}
          tabIndex={index === activeIndex ? 0 : -1}
          aria-pressed={isSelected}
          onClick={() => select(node.id)}
          aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, node.strongestState) })}
          data-testid={`lc-node-${node.id}`}
          data-state={node.strongestState}
          data-selected={isSelected ? 'true' : undefined}
          className={`w-full justify-start gap-2.5 text-left h-auto ${
            isSelected ? 'bg-primary/10 border border-primary/30' : 'border border-transparent'
          }`}
        >
          <span className={`w-7 h-7 rounded-card flex items-center justify-center shrink-0 ${STATE_SHAPE[node.strongestState]}`}>
            <Glyph className={`w-3.5 h-3.5 ${STATE_TEXT[node.strongestState]}`} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${isSelected ? 'typo-label text-primary' : 'typo-body text-foreground'}`}>{label}</span>
            <span className={`block typo-caption ${STATE_TEXT[node.strongestState]}`}>{bindingStateLabel(dl, node.strongestState)}</span>
          </span>
          <EvidenceDots node={node} />
        </Button>
      </li>
    );
  };

  const group = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <div role="group" aria-label={title} data-testid={testId}>
      <span className="block typo-card-label text-foreground px-2 pb-1">{title}</span>
      {/* The spine: one rule down the left of the group, so the rows read as a sequence. */}
      <ul className="border-l border-primary/15 pl-2 ml-3 space-y-0.5">
        {nodes.map((n, i) => row(n, offset + i))}
      </ul>
    </div>
  );

  return (
    <nav
      aria-label={dl.lc_journey_label}
      onKeyDown={onKeyDown}
      className="space-y-3"
      data-testid="lc-journey-stepper"
    >
      {group(dl.lc_lane_before, lanes.before, 0, 'lc-lane-before')}
      {group(dl.lc_lane_after, lanes.after, lanes.before.length, 'lc-lane-after')}
    </nav>
  );
}

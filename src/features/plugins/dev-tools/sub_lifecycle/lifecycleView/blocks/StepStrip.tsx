/**
 * The dense header strip: the whole journey compressed to one scrolling row of
 * chips, each a glyph + label + a state-coloured underline, with the two phases
 * separated by a lane caption rather than a second block. No evidence dots -
 * the ledger below shows the same history with more fidelity, and repeating it
 * twice is what made the original surface feel like a diagram you cannot read.
 *
 * Its reason to exist: on this surface the question is usually "what happened",
 * not "what is the shape of the practice". A strip costs one row and hands the
 * rest of the page to the ledger.
 */
import { Button } from '@/features/shared/components/buttons';

import { bindingStateLabel, stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { STATE_TEXT } from '../../journey/journeyStyles';
import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { useStepRoving } from './useStepRoving';

const UNDERLINE: Record<string, string> = {
  live: 'border-status-success', detected: 'border-status-info', pending: 'border-status-warning',
  missing: 'border-status-error', advisory: 'border-foreground/40',
};

export function StepStrip() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const chip = (node: JourneyNode, index: number) => {
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const isSelected = node.id === selected?.id;
    return (
      <Button
        key={node.id}
        variant="ghost"
        size="xs"
        ref={bind(index)}
        tabIndex={index === activeIndex ? 0 : -1}
        aria-pressed={isSelected}
        onClick={() => select(node.id)}
        aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, node.strongestState) })}
        data-testid={`lc-node-${node.id}`}
        data-state={node.strongestState}
        data-selected={isSelected ? 'true' : undefined}
        className={`shrink-0 gap-1.5 rounded-none border-b-2 ${UNDERLINE[node.strongestState]} ${
          isSelected ? 'bg-primary/10' : ''
        }`}
      >
        <Glyph className={`w-3.5 h-3.5 shrink-0 ${STATE_TEXT[node.strongestState]}`} aria-hidden />
        <span className={`whitespace-nowrap ${isSelected ? 'typo-label text-primary' : 'typo-caption text-foreground'}`}>
          {label}
        </span>
      </Button>
    );
  };

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      aria-label={dl.lc_journey_label}
      onKeyDown={onKeyDown}
      className="flex items-end gap-1 overflow-x-auto"
      data-testid="lc-journey-strip"
    >
      <span className="shrink-0 typo-caption uppercase tracking-[0.18em] text-foreground pr-1 pb-1">{dl.lc_lane_before}</span>
      <span className="shrink-0 flex" data-testid="lc-lane-before">{lanes.before.map((n, i) => chip(n, i))}</span>
      <span aria-hidden className="shrink-0 w-px h-6 bg-primary/20 mx-2" />
      <span className="shrink-0 typo-caption uppercase tracking-[0.18em] text-foreground pr-1 pb-1">{dl.lc_lane_after}</span>
      <span className="shrink-0 flex" data-testid="lc-lane-after">
        {lanes.after.map((n, i) => chip(n, lanes.before.length + i))}
      </span>
    </div>
  );
}

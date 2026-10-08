/**
 * "Move to milestone": a Listbox of the project's other open milestones plus
 * Unassigned, writing through the canvas's ONE bind door
 * (`canvas.bindGoal` -> `milestoneOps.moveGoalToMilestone`), so the strip, the
 * menu and this list can never disagree about what a move means.
 */
import { ArrowRightLeft, ChevronDown, Flag, Inbox } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Listbox } from '@/features/shared/components/forms/Listbox';

import { useProgressView } from '../../canvasHost';
import type { ProjectLayer } from '../layerModel';
import { moveTargets, type MoveTarget } from './goalMoveRules';

const MENU_MAX_HEIGHT = 320;

interface MoveToMilestoneProps {
  goalId: string;
  layer: ProjectLayer;
  /** The milestone being viewed, `null` in the Unassigned view. */
  currentMilestoneId: string | null;
  /** The goal left this view: the caller clears the selection. */
  onMoved: () => void;
}

export function MoveToMilestone({ goalId, layer, currentMilestoneId, onMoved }: MoveToMilestoneProps) {
  const { canvas, dl } = useProgressView();
  const targets = moveTargets(
    layer.milestones.map((m) => m.lane),
    currentMilestoneId,
  );
  const pick = (t: MoveTarget) => {
    canvas.bindGoal(goalId, t.id);
    onMoved();
  };

  if (targets.length === 0) return null;

  return (
    <Listbox
      portal
      flipMenu
      menuMaxHeight={MENU_MAX_HEIGHT}
      itemCount={targets.length}
      onSelectFocused={(i) => {
        const t = targets[i];
        if (t) pick(t);
      }}
      ariaLabel={dl.layers_move_to}
      menuClassName="animate-fade-slide-in min-w-60 max-h-80 overflow-y-auto py-1 rounded-card border border-primary/20 bg-background/95 backdrop-blur-md shadow-elevation-3"
      renderTrigger={({ isOpen, toggle }) => (
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
          iconRight={<ChevronDown className={`w-3 h-3 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />}
          disabled={canvas.busy}
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          data-testid="layers-detail-move-to"
        >
          {dl.layers_move_to}
        </Button>
      )}
    >
      {({ close, focusIndex }) =>
        targets.map((t, i) => {
          const Icon = t.id ? Flag : Inbox;
          return (
            <Button
              key={t.id ?? '__unassigned'}
              variant="ghost"
              size="sm"
              role="option"
              aria-selected={i === focusIndex}
              onClick={() => {
                pick(t);
                close();
              }}
              data-testid={`layers-detail-move-target-${t.id ?? 'unassigned'}`}
              className={`w-full text-left ${i === focusIndex ? 'bg-primary/10' : ''}`}
              icon={<Icon className="w-3.5 h-3.5" />}
            >
              <span className="typo-body text-foreground truncate">{t.name ?? dl.layers_unassigned}</span>
            </Button>
          );
        })
      }
    </Listbox>
  );
}

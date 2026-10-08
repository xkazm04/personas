/**
 * The two stations at the end of the line. Both are drawn as DASHED rings so
 * they read as "not a milestone": the Unassigned station gathers the goals no
 * cut owns (it opens L2 with `UNASSIGNED`), the Add station creates a cut
 * through the canvas host's own name dialog.
 */
import { Plus } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { useProgressView } from '../../canvasHost';
import { GoalLines, STATION_W } from './MilestoneStation';
import { StationRing } from './StationRing';

export function UnassignedStation({
  goals,
  selected,
  onOpen,
  onOpenGoal,
}: {
  goals: readonly DevGoal[];
  selected: boolean;
  onOpen: () => void;
  onOpenGoal: (goalId: string) => void;
}) {
  const { tx } = useTranslation();
  const { dl } = useProgressView();
  return (
    <div className="flex flex-col items-stretch shrink-0 gap-2" style={{ width: STATION_W }} data-testid="layers-track-unassigned">
      <Button
        variant="ghost"
        onClick={onOpen}
        aria-pressed={selected}
        data-testid="layers-track-open-unassigned"
        className={`group w-full rounded-card py-3 [&>span]:w-full ${selected ? 'bg-primary/[0.08] ring-1 ring-primary/35' : ''}`}
      >
        <span className="flex flex-col items-center gap-2">
          <span className="relative z-10 rounded-full bg-background">
            <StationRing progress={null} dashed toneText="text-foreground" label={dl.layers_unassigned}>
              <span className="typo-data-lg text-foreground">{goals.length}</span>
            </StationRing>
          </span>
          <span className="typo-heading text-foreground text-center">{dl.layers_unassigned}</span>
          <span className="typo-caption text-foreground text-center">{dl.layers_unassigned_hint}</span>
          <span className="typo-caption text-foreground tabular-nums">{tx(dl.layers_goal_count, { count: goals.length })}</span>
        </span>
      </Button>
      <GoalLines goals={goals} onOpenGoal={onOpenGoal} onMore={onOpen} testPrefix="unassigned" />
    </div>
  );
}

export function AddStation({ projectId }: { projectId: string }) {
  const { canvas, dl } = useProgressView();
  return (
    <div className="flex flex-col items-stretch shrink-0" style={{ width: STATION_W }}>
      <Button
        variant="ghost"
        onClick={() => canvas.startCreateMilestone(projectId)}
        disabled={canvas.busy}
        data-testid="layers-track-add"
        className="group w-full rounded-card py-3 [&>span]:w-full"
      >
        <span className="flex flex-col items-center gap-2">
          <span className="relative z-10 rounded-full bg-background text-primary">
            <StationRing progress={null} dashed toneText="text-primary" label={dl.layers_add_milestone}>
              <Plus className="w-7 h-7 transition-transform duration-200 group-hover:rotate-90 motion-reduce:transition-none motion-reduce:transform-none" aria-hidden="true" />
            </StationRing>
          </span>
          <span className="typo-heading text-primary text-center">{dl.layers_add_milestone}</span>
        </span>
      </Button>
    </div>
  );
}

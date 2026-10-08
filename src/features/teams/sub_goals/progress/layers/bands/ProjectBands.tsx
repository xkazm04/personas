/**
 * BANDS - LAYER 1: one project's milestones as stacked segment bands, then the
 * unassigned goals (a dashed band), the ideas tray and the add-milestone row.
 *
 * Ghost bands while the lanes load (`useProjectLayer` is null until they do):
 * the goals are known, the cuts are not, and an empty-state there would claim
 * the project has no milestones.
 */
import { Flag } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

import { useProgressView } from '../../canvasHost';
import type { ProjectLayer } from '../layerModel';
import { milestoneProgress } from '../layerModel';
import { UNASSIGNED } from '../useLayers';
import { Band } from './Band';
import { AddMilestoneRow, GhostBands, MilestoneMetaLine } from './bandParts';
import { IdeasRow } from './IdeasRow';
import { isComplete } from '../../../goalStatus';

export function ProjectBands({
  layer,
  onOpenMilestone,
}: {
  layer: ProjectLayer | null;
  /** Open L2 on a milestone (or `UNASSIGNED`), optionally with a goal selected. */
  onOpenMilestone: (milestoneId: string, goalId?: string) => void;
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { canvas } = useProgressView();

  if (!layer) return <GhostBands />;

  const { milestones, unassigned, ideas, projectId } = layer;

  return (
    <div className="flex flex-col gap-2.5" data-testid="layers-bands-project">
      {milestones.length === 0 ? (
        <ScenarioEmptyState
          icon={Flag}
          title={dl.layers_no_milestones}
          subtitle={dl.layers_no_milestones_hint}
          action={{ label: dl.layers_add_milestone, icon: Flag, onClick: () => canvas.startCreateMilestone(projectId) }}
        />
      ) : (
        milestones.map((card) => (
          <Band
            key={card.lane.id}
            testId={`layers-bands-band-${card.lane.id}`}
            title={card.lane.name}
            subtitle={card.lane.objective}
            meta={<MilestoneMetaLine lane={card.lane} />}
            goals={card.goals}
            progress={card.progress}
            doneCount={card.doneCount}
            onOpen={() => onOpenMilestone(card.lane.id)}
            onOpenGoal={(goalId) => onOpenMilestone(card.lane.id, goalId)}
          />
        ))
      )}

      {unassigned.length > 0 && (
        <Band
          dashed
          testId="layers-bands-unassigned"
          title={dl.layers_unassigned}
          subtitle={dl.layers_unassigned_hint}
          goals={unassigned}
          progress={milestoneProgress(unassigned)}
          doneCount={unassigned.filter((g) => isComplete(g.status)).length}
          onOpen={() => onOpenMilestone(UNASSIGNED)}
          onOpenGoal={(goalId) => onOpenMilestone(UNASSIGNED, goalId)}
        />
      )}

      {ideas.length > 0 && <IdeasRow projectId={projectId} ideas={ideas} />}

      {milestones.length > 0 && <AddMilestoneRow projectId={projectId} />}
    </div>
  );
}

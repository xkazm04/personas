/**
 * LAYER 2 - one milestone opened: its brief note and its goals.
 * STUB (WP0): the final props; WP1 builds the body.
 */
import type { ProjectLayer } from '../layerModel';

export interface MilestoneDetailProps {
  layer: ProjectLayer;
  /** A milestone id of `layer`, or `UNASSIGNED` for the project's unbound goals. */
  milestoneId: string;
  goalId: string | null;
  onSelectGoal: (goalId: string | null) => void;
  onClose: () => void;
  /** `panel` - a side panel beside L1 (~460px); `full` - the whole canvas width. */
  layout: 'panel' | 'full';
}

export function MilestoneDetail({ milestoneId, layout }: MilestoneDetailProps) {
  return <div data-testid="layers-milestone-detail" data-milestone={milestoneId} data-layout={layout} />;
}

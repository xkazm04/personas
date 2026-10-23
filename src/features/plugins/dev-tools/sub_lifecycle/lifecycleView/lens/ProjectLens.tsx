/**
 * The Lens below the portfolio, for the focused project: its columns (L2),
 * or, when a step is open, that step's detail (L3, the last layer). The view
 * model's `openStepId` decides which; the step screen's Esc closes it.
 *
 * Mounted by the page under its providers (the Measure session, the time
 * cursor) and by the step and preset tests on a fixture model.
 */
import { memo } from 'react';

import { Banner } from '@/features/shared/components/feedback/Banner';

import { useLifecycleViewModel } from '../context';
import { DetailPlane } from './planes/DetailPlane';
import { ProjectPlane } from './planes/ProjectPlane';

export const ProjectLens = memo(function ProjectLens({ litStepId = null, intro = false, onSelect }: {
  litStepId?: string | null;
  intro?: boolean;
  onSelect?: (stepId: string) => void;
}) {
  const { dl, order, openStepId, error, refetch, select, selected } = useLifecycleViewModel();
  const open = openStepId ? order.find((n) => n.id === openStepId) ?? null : null;
  if (open) return <DetailPlane node={open} />;
  return (
    <>
      {error && <Banner severity="error" compact message={dl.lc_load_failed} cause={error} onRetry={refetch} />}
      <ProjectPlane litStepId={litStepId ?? selected?.id ?? null} intro={intro} onSelect={onSelect ?? select} />
    </>
  );
});

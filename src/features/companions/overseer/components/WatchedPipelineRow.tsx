/**
 * One watched pipeline: the project, its "All steps green" goal drawn as a
 * quantity (green steps of the measurable ones), the instructed and open-item
 * counts, and when it was last measured. Pressing the row opens the project's
 * Lifecycle page.
 */
import type { ReactNode } from 'react';

import { ListRow, Meta, UnitStrip, quantumFor } from '@/features/shared/components/kit';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleWatchedPipeline } from '@/lib/bindings/LifecycleWatchedPipeline';

/** Units a row's strip may draw before the quantum steps up the 1-2-5 ladder. */
const MAX_UNITS = 20;

export function WatchedPipelineRow({ pipeline, onOpen }: {
  pipeline: LifecycleWatchedPipeline;
  onOpen: (projectId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.director;
  const { goal } = pipeline;

  let meta: ReactNode = d.watched_pipelines_not_sent;
  let figures: ReactNode = undefined;
  if (goal) {
    const progress = tx(d.watched_pipelines_progress, {
      green: goal.measurableGreen,
      total: goal.measurableTotal,
      instructed: goal.instructed,
    });
    meta = <Meta parts={[progress, tx(d.watched_pipelines_open, { count: goal.openItems })]} />;
    const q = quantumFor(goal.measurableTotal, MAX_UNITS);
    const green = Math.min(goal.measurableGreen, goal.measurableTotal);
    figures = (
      <UnitStrip
        size="s"
        label={progress}
        legend={q > 1 ? tx(d.watched_pipelines_unit, { count: q }) : undefined}
        segments={[
          { n: green / q, tone: 'success' },
          { n: (goal.measurableTotal - green) / q, tone: 'neutral', glyph: 'empty' },
        ]}
      />
    );
  }

  return (
    <ListRow
      name={pipeline.projectName}
      meta={meta}
      figures={figures}
      time={
        pipeline.lastMeasuredAt
          ? <RelativeTime timestamp={pipeline.lastMeasuredAt} />
          : d.watched_pipelines_never_measured
      }
      onPress={() => onOpen(pipeline.projectId)}
      testId={`watched-pipeline-${pipeline.projectId}`}
    />
  );
}

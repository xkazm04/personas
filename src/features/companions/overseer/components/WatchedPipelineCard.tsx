/**
 * One watched pipeline as a card (a kit Tile): the project's name, which
 * opens its Lifecycle page; its standing on the card's rail (failing, at risk,
 * not every step measured, all green); when it was last measured; its steps as
 * a mini rail with the verdict counts in words under it; the Overseer's goal
 * drawn as a quantity (green of the measurable steps) with his open items, or
 * "Not sent yet" for a pipeline he watches but holds no goal for; and the
 * explicit way in, "Open Lifecycle".
 */
import { ArrowUpRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Meta, Tile, UnitStrip, quantumFor, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleWatchedPipeline } from '@/lib/bindings/LifecycleWatchedPipeline';

import { standingOf, type PipelineStanding } from '../watchedModel';
import { PipelineMiniRail, useVerdictWords } from './PipelineMiniRail';

/** Units a card's strip may draw before the quantum steps up the 1-2-5 ladder. */
const MAX_UNITS = 20;

const STANDING_TONE: Record<Exclude<PipelineStanding, 'none'>, Tone> = {
  red: 'error', amber: 'warning', open: 'info', green: 'success',
};

function GoalLine({ pipeline }: { pipeline: LifecycleWatchedPipeline }) {
  const { t, tx } = useTranslation();
  const d = t.director;
  const { goal } = pipeline;
  if (!goal) return <p className="typo-caption" data-testid="watched-not-sent">{d.watched_pipelines_not_sent}</p>;
  const progress = tx(d.watched_pipelines_progress, { green: goal.measurableGreen, total: goal.measurableTotal, instructed: goal.instructed });
  const q = quantumFor(goal.measurableTotal, MAX_UNITS);
  const green = Math.min(goal.measurableGreen, goal.measurableTotal);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="watched-goal">
      <span className="typo-label">{d.lcx9_goal_label}</span>
      <UnitStrip
        size="s"
        label={progress}
        legend={q > 1 ? tx(d.watched_pipelines_unit, { count: q }) : undefined}
        segments={[
          { n: green / q, tone: 'success' },
          { n: (goal.measurableTotal - green) / q, tone: 'neutral', glyph: 'empty' },
        ]}
      />
      <span className="typo-caption">
        <Meta parts={[progress, goal.openItems === 1 ? d.lcx9_open_one : tx(d.watched_pipelines_open, { count: goal.openItems })]} />
      </span>
    </div>
  );
}

export function WatchedPipelineCard({ pipeline, span, onOpen }: {
  pipeline: LifecycleWatchedPipeline;
  span: number;
  onOpen: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const d = t.director;
  const words = useVerdictWords();
  const standing = standingOf(pipeline.steps);
  const markLabel = {
    red: d.lcx9_mark_red, amber: d.lcx9_mark_amber, open: d.lcx9_mark_open, green: d.lcx9_mark_green,
  };
  const open = () => onOpen(pipeline.projectId);
  return (
    <Tile
      span={span}
      title={pipeline.projectName}
      meta={pipeline.lastMeasuredAt
        ? <span data-testid="watched-measured"><MeasuredAt at={pipeline.lastMeasuredAt} template={d.lcx9_last_measured} /></span>
        : <span data-testid="watched-measured">{d.watched_pipelines_never_measured}</span>}
      mark={standing === 'none' ? undefined : { tone: STANDING_TONE[standing], glyph: standing === 'open' ? 'hollow' : 'solid', label: markLabel[standing] }}
      onPress={open}
      footer={(
        <Button variant="secondary" size="sm" iconRight={<ArrowUpRight className="h-4 w-4" />} onClick={open} data-testid={`watched-open-${pipeline.projectId}`}>
          {d.lcx9_open_lifecycle}
        </Button>
      )}
      testId={`watched-pipeline-${pipeline.projectId}`}
    >
      {/* A tile body has no gutter of its own (kit parts bring theirs): this figure takes the head's. */}
      <div className="flex flex-col gap-3 pl-[var(--gutter)] pr-3">
        {pipeline.steps.length > 0 ? (
          <>
            <PipelineMiniRail steps={pipeline.steps} />
            <p className="typo-caption"><Meta parts={words(pipeline.steps)} /></p>
          </>
        ) : <p className="typo-caption">{d.lcx9_no_steps}</p>}
        <GoalLine pipeline={pipeline} />
      </div>
    </Tile>
  );
}

/** "Measured 2 h ago": the template's {time} slot holds a live relative time. */
function MeasuredAt({ at, template }: { at: string; template: string }) {
  const [before, after = ''] = template.split('{time}');
  return <>{before}<RelativeTime timestamp={at} />{after}</>;
}

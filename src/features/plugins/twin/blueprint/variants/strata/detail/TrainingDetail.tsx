/**
 * Training at L2: the six topics as tiles (approved answers solid, awaiting
 * review hatched, full at the covered tier), the plan's goals as a full-width
 * table (so a planner's title reads whole), the question-kind mix and the
 * totals. A topic or a goal opens itself in L3.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { TwinBlueprintModel } from '../../../blueprintContract';
import { TRAINING_TOPIC_PRESETS } from '../../../../sub_training/topicPresets';
import { StrataFigure } from '../StrataFigure';
import { TOPIC_FULL_AT } from '../strataModel';
import { GoalRows } from './GoalRows';
import { KindMix } from './KindMix';
import { PressRow, StrataMeter } from './StrataMeter';

export function TrainingDetail({ model, onOpen }: { model: TwinBlueprintModel; onOpen: (key?: string) => void }) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const { topics, answered, observations, lastTrainedAt } = model.training;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="typo-label text-primary">{tb.metrics.topics}</span>
        <div className="strata-three">
          {topics.map((topic) => {
            const preset = TRAINING_TOPIC_PRESETS.find((p) => p.id === topic.id);
            const label = preset ? t.twin.training[preset.labelKey] : topic.id;
            return (
              <PressRow key={topic.id} label={label} onPress={() => onOpen(topic.id)} className="strata-tile" testId={`strata-topic-${topic.id}`}>
                <TruncateWithTooltip text={label} className="typo-body text-foreground" />
                <span className="strata-tile-meter">
                  <StrataMeter value={topic.approved} extra={topic.awaiting} fullAt={TOPIC_FULL_AT} />
                  <StrataFigure value={topic.approved} className="typo-data text-foreground" />
                  <span className="typo-label" data-tier={topic.tier}>{tb.tiers[topic.tier]}</span>
                </span>
              </PressRow>
            );
          })}
        </div>
      </div>

      <GoalRows model={model} onOpen={onOpen} />
      <KindMix model={model} />

      <div className="strata-totals">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="typo-caption">{tb.metrics.answers}</span>
          <StrataFigure value={answered} className="typo-data text-foreground" />
        </span>
        <span className="inline-flex items-baseline gap-1.5">
          <span className="typo-caption">{tb.metrics.observations}</span>
          <StrataFigure value={observations} className="typo-data text-foreground" />
        </span>
        <span className="inline-flex items-baseline gap-1.5">
          <span className="typo-caption">{tb.metrics.lastTrained}</span>
          {lastTrainedAt ? (
            <RelativeTime timestamp={lastTrainedAt} className="typo-data text-foreground" />
          ) : (
            <span className="typo-body text-foreground">{tb.metrics.neverTrained}</span>
          )}
        </span>
      </div>
    </div>
  );
}

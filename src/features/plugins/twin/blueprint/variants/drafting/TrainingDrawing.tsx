import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { TRAINING_TOPIC_PRESETS } from '../../../sub_training/topicPresets';
import type { BlueprintDelta, TwinBlueprintModel } from '../../blueprintContract';
import GoalGauges from './GoalGauges';
import KindMixStrip from './KindMixStrip';
import { Letter } from './Lettering';
import TopicBar from './TopicBar';

type Training = TwinBlueprintModel['training'];

/** The translated name of a training topic. */
export function useTopicLabel() {
  const { t } = useTranslation();
  return (id: string) => {
    const preset = TRAINING_TOPIC_PRESETS.find((p) => p.id === id);
    return preset ? t.twin.training[preset.labelKey] : id;
  };
}

/**
 * Training on layer one (and, `compact`, beside the card in stage mode): the
 * six topics as scale bars, the plan's goals as gauges, and, when the sheet
 * has room, the kind mix and the answer count. The mark the last answer landed
 * on is lit and drawn in again.
 */
export default function TrainingDrawing({
  training,
  compact = false,
  targetKey = null,
  targetGoalId = null,
  delta = null,
  reduced,
  register,
}: {
  training: Training;
  compact?: boolean;
  targetKey?: string | null;
  targetGoalId?: string | null;
  delta?: BlueprintDelta | null;
  reduced: boolean;
  register?: (key: string) => (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const topicLabel = useTopicLabel();
  const playKey = delta ? `${delta.answeredStepId}:${delta.phase}` : null;

  return (
    <div className={`twd-topics flex min-h-0 flex-col ${compact ? 'gap-2' : 'gap-3'}`}>
      <ul className="flex flex-col gap-0.5">
        {training.topics.map((topic) => (
          <li key={topic.id}>
            <TopicBar
              topic={topic}
              label={topicLabel(topic.id)}
              targeted={targetKey === `topic:${topic.id}`}
              playKey={playKey}
              reduced={reduced}
              markRef={register?.(`topic:${topic.id}`)}
              penRef={register?.(`pen:topic:${topic.id}`)}
            />
          </li>
        ))}
      </ul>
      {training.goals.length > 0 ? (
        <div className={`flex flex-col gap-1.5 ${compact ? 'twd-tall-only' : 'twd-goals-l1'}`}>
          <Letter>{m.goals}</Letter>
          <GoalGauges
            goals={training.goals}
            targetGoalId={targetGoalId}
            gain={delta?.phase === 'reconciled' ? delta.coverageGain : null}
            playKey={playKey}
            reduced={reduced}
            register={register}
          />
        </div>
      ) : (
        !compact && <p className="typo-caption">{t.twin.blueprint.states.emptyTraining}</p>
      )}
      {!compact && (
        <div className="twd-roomy-only flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Letter>{m.kinds}</Letter>
            <span className="flex items-baseline gap-2">
              <Numeric value={training.answered} className="typo-data text-foreground" />
              <span className="typo-caption">{m.answers}</span>
            </span>
          </div>
          <KindMixStrip mix={training.kindMix} />
        </div>
      )}
    </div>
  );
}

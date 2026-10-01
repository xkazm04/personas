/**
 * The plan's live goals for the L3 Training section (spark
 * twin-portable-blueprint): what each one is trying to learn, what counts as
 * covered, how far the answers have got, and the reason the last answer moved
 * it. Read-only: pinning and dropping stay in the experience's plan layer.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupGoal } from '@/lib/bindings/SetupGoal';

import { SETUP_FOCUS_ORDER } from '../../setup/setupContract';
import { TRAINING_TOPIC_PRESETS } from '../../sub_training/topicPresets';
import { topicOfSlot } from '../blueprintDelta';
import { CoverageBar, itemFirst } from './detailParts';

export function TrainingGoals({ goals, itemKey }: { goals: readonly SetupGoal[]; itemKey?: string }) {
  const { t } = useTranslation();
  const plan = t.twin.experience.plan;
  const b = t.twin.blueprint;
  const live = goals.filter((g) => g.state !== 'dropped');
  const ordered = itemFirst(live, (g) => g.id === itemKey || topicOfSlot(g.slot) === itemKey);

  const labelOf = (g: SetupGoal) => {
    const slot = SETUP_FOCUS_ORDER.find((s) => s === g.slot);
    if (slot) return t.twin.experience.slots[slot].label;
    const topic = TRAINING_TOPIC_PRESETS.find((p) => p.id === topicOfSlot(g.slot));
    return topic ? t.twin.training[topic.labelKey] : plan.phaseTraining;
  };

  if (ordered.length === 0) return <p className="typo-caption">{plan.empty}</p>;

  return (
    <ul className="flex flex-col gap-3" data-testid="twin-detail-goals">
      {ordered.map((g) => (
        <li
          key={g.id}
          className="rounded-card border border-primary/15 px-3 py-2.5 flex flex-col gap-2"
          data-testid={`twin-detail-goal-${g.id}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="typo-caption text-primary">{labelOf(g)}</p>
            <span className="flex items-baseline gap-1.5">
              <span className="typo-caption">{b.metrics.answers}</span>
              <Numeric value={g.answered} className="typo-data text-foreground" />
            </span>
          </div>
          <p className="typo-body text-foreground">{g.title}</p>
          <CoverageBar value={g.coverage} label={plan.coverage} testId={`twin-detail-coverage-${g.id}`} />
          {g.criteria.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="typo-label text-foreground">{t.twin.detail.criteria}</p>
              <ul className="list-disc pl-5 flex flex-col gap-0.5">
                {g.criteria.map((criterion, i) => (
                  <li key={i} className="typo-caption">
                    {criterion}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {g.lastWhy && (
            <p className="typo-caption" data-testid={`twin-detail-why-${g.id}`}>
              <span className="typo-label text-foreground">{b.delta.why}</span> {g.lastWhy}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default TrainingGoals;

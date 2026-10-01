/**
 * Dossier (WP9), Training at a glance: the six topic bars (awaiting review
 * hatched) and, beside them, the plan's goals as coverage columns and the
 * answer kinds as one apportioned strip with the answered count. On a stage rail the topics stand
 * as unlabelled columns (labelled bars when the rail has room), and the goal
 * the last answer moved is drawn as its own meter, the reconciled gain growing
 * in as a segment of its own.
 */
import { useTranslation } from '@/i18n/useTranslation';

import { Figure } from '../Figure';
import { TopicBars, TopicColumns } from '../TopicBars';
import { GoalColumns, GoalMeter, KindStrip } from '../TrainingMarks';
import type { GlanceProps } from './glanceTypes';

export function TrainingGlance({ model, compact, roomy, delta, spring, reduced }: GlanceProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const { topics, goals, answered, kindMix } = model.training;
  const hotTopic = delta?.topicId ?? null;
  const hotGoal = delta?.goalId ? goals.find((g) => g.id === delta.goalId) ?? null : null;
  const gainKey = delta ? `${delta.answeredStepId}:${delta.phase}` : undefined;

  if (compact) {
    return (
      <div className="dossier-glance" data-testid="dossier-training">
        {roomy ? (
          <TopicBars topics={topics} hotTopic={hotTopic} spring={spring} reduced={reduced} />
        ) : (
          <TopicColumns topics={topics} hotTopic={hotTopic} />
        )}
        {hotGoal && <span className="typo-caption k-in" data-testid="dossier-hot-goal">{hotGoal.title}</span>}
        {hotGoal && (
          <div className="dossier-line k-in">
            <GoalMeter goal={hotGoal} gain={delta?.coverageGain ?? null} gainKey={gainKey} reduced={reduced} />
            <Figure value={hotGoal.coverage} unit="ratio" spring={spring} reduced={reduced} />
          </div>
        )}
        <div className="dossier-line k-in">
          <KindStrip kindMix={kindMix} hotKind={delta?.kind ?? null} maxUnits={20} />
          <Figure value={answered} spring={spring} reduced={reduced} testId="dossier-answered" />
        </div>
      </div>
    );
  }

  return (
    <div className="dossier-glance dossier-train" data-testid="dossier-training">
      <TopicBars topics={topics} hotTopic={hotTopic} spring={spring} reduced={reduced} />
      <div className="dossier-train__aside">
        <div className="dossier-train__part">
          <span className="typo-label dossier-key">{tb.metrics.goals}</span>
          <GoalColumns goals={goals} hotGoal={hotGoal?.id ?? null} />
        </div>
        <div className="dossier-train__part">
          <span className="typo-label dossier-key">{tb.metrics.kinds}</span>
          <span className="dossier-line">
            <KindStrip kindMix={kindMix} hotKind={delta?.kind ?? null} maxUnits={roomy ? 40 : 18} />
            <Figure value={answered} spring={spring} reduced={reduced} testId="dossier-answered" />
          </span>
        </div>
      </div>
    </div>
  );
}

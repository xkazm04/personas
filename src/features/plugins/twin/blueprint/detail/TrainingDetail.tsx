/**
 * L3 Training: what training has covered, in full (spark
 * twin-portable-blueprint): the answer count and when it last happened, the
 * plan's goals, the six topics with their approved and awaiting answers, the
 * mix of question kinds, what the engine has noticed, and the last questions
 * answered.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ChipRow, KeyValueGrid, ListRow, Rows, Section, type Chip } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { TRAINING_TOPIC_PRESETS } from '../../sub_training/topicPresets';
import type { StepKind } from '../blueprintContract';
import type { SectionDetailProps } from './detailParts';
import { TrainingGoals } from './TrainingGoals';

/** How many of the last answers the drawer lists. */
const RECENT = 6;
const KIND_ORDER: readonly StepKind[] = ['scene', 'opinion', 'reply_drill', 'fact', 'rule', 'preference'];

export function TrainingDetail({ model, sources, itemKey }: SectionDetailProps) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const m = b.metrics;
  const plan = t.twin.experience.plan;
  const { training } = model;
  const snapshot = sources.snapshot;
  const recent = (snapshot?.transcript ?? [])
    .filter((s) => s.status === 'answered' || s.status === 'skipped')
    .slice(-RECENT)
    .reverse();
  const kinds: Chip[] = KIND_ORDER.flatMap((kind) => {
    const count = training.kindMix[kind];
    return count ? [{ id: kind, label: b.kinds[kind], count: <Numeric value={count} /> }] : [];
  });

  return (
    <div className="flex flex-col gap-5" data-testid="twin-detail-training">
      <KeyValueGrid
        items={[
          { k: m.answers, v: <Numeric value={training.answered} /> },
          { k: m.observations, v: <Numeric value={training.observations} /> },
          {
            k: m.lastTrained,
            v: training.lastTrainedAt ? <RelativeTime timestamp={training.lastTrainedAt} /> : null,
            none: m.neverTrained,
          },
        ]}
      />
      <Section level={2} title={m.goals}>
        <TrainingGoals goals={snapshot?.goals ?? []} itemKey={itemKey} />
      </Section>
      <Section level={2} title={m.topics}>
        <Rows count={training.topics.length} empty={{ title: b.states.emptyTraining }}>
          {training.topics.map((topic) => {
            const preset = TRAINING_TOPIC_PRESETS.find((p) => p.id === topic.id);
            return (
              <ListRow
                key={topic.id}
                name={preset ? t.twin.training[preset.labelKey] : topic.id}
                meta={
                  <>
                    {b.tiers[topic.tier]} · {m.awaiting} <Numeric value={topic.awaiting} />
                  </>
                }
                figures={<Numeric value={topic.approved} className="typo-data" />}
                state={topic.id === itemKey ? 'selected' : undefined}
                testId={`twin-detail-topic-${topic.id}`}
              />
            );
          })}
        </Rows>
      </Section>
      {kinds.length > 0 && (
        <Section level={2} title={m.kinds}>
          <ChipRow chips={kinds} label={m.kinds} emptyLabel={b.states.emptyTraining} />
        </Section>
      )}
      <Section level={2} title={plan.noticed}>
        {snapshot && snapshot.observations.length > 0 ? (
          <ul className="flex flex-col gap-2" data-testid="twin-detail-observations">
            {snapshot.observations.map((o) => (
              <li key={o.id} className="typo-body text-foreground border-l-2 border-primary/20 pl-3">
                {o.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="typo-caption">{plan.noticedEmpty}</p>
        )}
      </Section>
      <Section level={2} title={t.twin.detail.lastAnswers}>
        {recent.length > 0 ? (
          <ul className="flex flex-col gap-3" data-testid="twin-detail-answers">
            {recent.map((step) => (
              <li key={step.id} className="flex flex-col gap-0.5">
                <p className="typo-caption">{step.question}</p>
                <p className="typo-body text-foreground whitespace-pre-wrap break-words">
                  {step.answer ?? t.twin.experience.table.skipped}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="typo-caption">{b.states.emptyTraining}</p>
        )}
      </Section>
    </div>
  );
}

export default TrainingDetail;

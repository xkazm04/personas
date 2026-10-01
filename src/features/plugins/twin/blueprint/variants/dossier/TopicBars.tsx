/**
 * Dossier (WP9): the six training topics on one declared domain (0 to twice
 * the covered threshold, so "covered" is the tick at the middle of every bar).
 * Approved answers fill the bar; answers still awaiting review continue it as
 * a hatched segment; a topic past the domain fills it and its figure says by
 * how much. `TopicBars` is the labelled horizontal form (layer one, L2);
 * `TopicColumns` the unlabelled vertical form a narrow stage rail can hold
 * (the answer's readout under it names the topic it lit).
 */
import type { CSSProperties } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintTopic, TopicId } from '../../blueprintContract';
import { TRAINING_TOPIC_PRESETS } from '../../../sub_training/topicPresets';
import { TOPIC_COVERED_AT, TOPIC_DOMAIN, share } from './dossierModel';
import { Figure } from './Figure';

/** The translated label of a topic id. */
export function useTopicLabel(): (id: TopicId) => string {
  const { t } = useTranslation();
  return (id) => {
    const preset = TRAINING_TOPIC_PRESETS.find((p) => p.id === id);
    return preset ? t.twin.training[preset.labelKey] : id;
  };
}

function useTopicAria(): (topic: BlueprintTopic) => string {
  const { t, tx } = useTranslation();
  const label = useTopicLabel();
  return (topic) =>
    tx(t.twin.blueprint.variantCopy.dossier.topicAria, { topic: label(topic.id), approved: topic.approved, awaiting: topic.awaiting });
}

/** The bar's geometry as CSS variables: approved share, awaiting share after it, the covered tick. */
function barStyle(topic: BlueprintTopic): CSSProperties {
  const approved = share(topic.approved, TOPIC_DOMAIN);
  const awaiting = Math.min(1 - approved, share(topic.awaiting, TOPIC_DOMAIN));
  return { '--a': approved, '--w': awaiting, '--tick': TOPIC_COVERED_AT / TOPIC_DOMAIN } as CSSProperties;
}

interface TopicBarsProps {
  topics: readonly BlueprintTopic[];
  hotTopic?: TopicId | null;
  /** L2: the tier word after the figure. */
  tiers?: boolean;
  spring?: boolean;
  reduced: boolean;
}

export function TopicBars({ topics, hotTopic, tiers, spring, reduced }: TopicBarsProps) {
  const { t } = useTranslation();
  const label = useTopicLabel();
  const aria = useTopicAria();
  return (
    <div className="dossier-topics k-in" data-testid="dossier-topics" data-tiers={tiers ? 'true' : undefined}>
      {topics.map((topic) => (
        <div key={topic.id} className="dossier-topic" data-hot={hotTopic === topic.id ? 'true' : undefined}>
          <span className="typo-body dossier-topic__name">{label(topic.id)}</span>
          <span className="dossier-bar" role="img" aria-label={aria(topic)} style={barStyle(topic)}>
            <span className="dossier-bar__approved" />
            <span className="dossier-bar__awaiting" />
            <span className="dossier-bar__tick" />
          </span>
          <span className="dossier-topic__figs">
            <Figure value={topic.approved} spring={spring && hotTopic === topic.id} reduced={reduced} />
            {topic.awaiting > 0 && (
              <Numeric className="typo-data dossier-awaiting">
                +<Numeric value={topic.awaiting} />
              </Numeric>
            )}
          </span>
          {tiers && <span className="typo-label dossier-topic__tier" data-tier={topic.tier}>{t.twin.blueprint.tiers[topic.tier]}</span>}
        </div>
      ))}
    </div>
  );
}

export function TopicColumns({ topics, hotTopic }: { topics: readonly BlueprintTopic[]; hotTopic: TopicId | null }) {
  const aria = useTopicAria();
  return (
    <div className="dossier-cols-wrap k-in" data-testid="dossier-topic-columns">
      <div className="dossier-cols">
        {topics.map((topic) => (
          <span
            key={topic.id}
            className="dossier-col"
            role="img"
            aria-label={aria(topic)}
            data-hot={hotTopic === topic.id ? 'true' : undefined}
            style={barStyle(topic)}
          >
            <span className="dossier-bar__approved" />
            <span className="dossier-bar__awaiting" />
            <span className="dossier-bar__tick" />
          </span>
        ))}
      </div>
    </div>
  );
}

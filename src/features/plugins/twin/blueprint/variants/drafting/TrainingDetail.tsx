import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { BlueprintGoal, TwinBlueprintModel } from '../../blueprintContract';
import KindMixStrip from './KindMixStrip';
import { Balloon, Letter } from './Lettering';
import PressRow from './PressRow';
import TopicBar from './TopicBar';
import { useTopicLabel } from './TrainingDrawing';

type Training = TwinBlueprintModel['training'];

/**
 * Training zoomed (L2): the six topics with their counts and tiers and, under
 * them, the kind mix with its key; beside them the plan's goals, each a
 * numbered title over its coverage line. A topic or a goal opens its full
 * detail.
 */
export default function TrainingDetail({
  training,
  reduced,
  onOpen,
}: {
  training: Training;
  reduced: boolean;
  onOpen: (itemKey: string) => void;
}) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const topicLabel = useTopicLabel();

  return (
    <div className="grid min-h-0 flex-1 gap-8" style={{ gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)' }}>
      <section className="twd-topics flex min-h-0 flex-col gap-2">
        <Letter>{m.topics}</Letter>
        <ul className="flex flex-col gap-0.5">
          {training.topics.map((topic) => (
            <li key={topic.id}>
              <PressRow label={topicLabel(topic.id)} onPress={() => onOpen(topic.id)}>
                <TopicBar topic={topic} label={topicLabel(topic.id)} detailed reduced={reduced} />
              </PressRow>
            </li>
          ))}
        </ul>
        <footer className="mt-auto flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--ink-faint)' }}>
          <Letter>{m.kinds}</Letter>
          <KindMixStrip mix={training.kindMix} legend />
        </footer>
      </section>
      <section className="flex min-h-0 flex-col gap-2">
        <Letter>{m.goals}</Letter>
        {training.goals.length === 0 ? (
          <p className="typo-caption">{t.twin.blueprint.states.emptyTraining}</p>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {training.goals.map((g, i) => (
              <li key={g.id}>
                <GoalLine goal={g} number={i + 1} onOpen={() => onOpen(g.id)} />
              </li>
            ))}
          </ol>
        )}
        <div className="mt-auto flex flex-wrap items-baseline gap-x-6 gap-y-1 pt-2" style={{ borderTop: '1px solid var(--ink-faint)' }}>
          <Meta label={m.answers} value={training.answered} />
          <Meta label={m.observations} value={training.observations} />
          <span className="flex items-baseline gap-2">
            <Letter>{m.lastTrained}</Letter>
            {training.lastTrainedAt ? (
              <RelativeTime timestamp={training.lastTrainedAt} className="typo-body text-foreground" />
            ) : (
              <span className="typo-caption">{m.neverTrained}</span>
            )}
          </span>
        </div>
      </section>
    </div>
  );
}

/** A lettered count; `null` (not measured) is a dash, never a 0. */
function Meta({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="flex items-baseline gap-2" data-measured={value === null ? 'false' : 'true'}>
      <Letter>{label}</Letter>
      {value === null ? <span className="typo-caption">-</span> : <Numeric value={value} className="typo-data text-foreground" />}
    </span>
  );
}

/** One goal: its number, its title in full (two lines at most), and its coverage drawn under it. */
function GoalLine({ goal, number, onOpen }: { goal: BlueprintGoal; number: number; onOpen: () => void }) {
  const cov = Math.min(1, Math.max(0, goal.coverage));
  const dropped = goal.state === 'dropped';
  return (
    <PressRow label={goal.title} onPress={onOpen} className="flex items-start gap-3 px-1.5 py-1">
      <span data-goal={goal.id} data-state={goal.state} className="contents">
        <Balloon inked={!dropped && cov > 0}>{number}</Balloon>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`line-clamp-2 typo-body text-foreground ${dropped ? 'line-through' : ''}`}>{goal.title}</span>
          <span className="flex items-center gap-3">
            <span
              aria-hidden
              className="relative h-2.5 min-w-0 flex-1"
              style={{ border: `1px ${dropped || cov === 0 ? 'dashed' : 'solid'} ${goal.state === 'covered' ? 'var(--ink)' : 'var(--ink-dim)'}` }}
            >
              {!dropped && <span className="absolute inset-y-0 left-0" style={{ width: `${cov * 100}%`, background: 'var(--ink)' }} />}
            </span>
            <Numeric value={cov} unit="ratio" precision={0} className="inline-block w-12 shrink-0 text-right typo-data text-foreground" />
          </span>
        </span>
      </span>
    </PressRow>
  );
}

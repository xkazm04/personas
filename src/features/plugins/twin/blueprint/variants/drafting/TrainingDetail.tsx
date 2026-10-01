import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { BlueprintGoal, TwinBlueprintModel } from '../../blueprintContract';
import KindMixStrip from './KindMixStrip';
import { Balloon, Letter } from './Lettering';
import PressRow from './PressRow';
import TopicBar from './TopicBar';
import { useTopicLabel } from './TrainingDrawing';
import DrawFrame from './draw/DrawFrame';
import Write, { WriteNumber } from './draw/Write';

type Training = TwinBlueprintModel['training'];

/** A ruled line across the top of a footer: a frame. */
function TopRule() {
  return (
    <i
      aria-hidden
      data-draw="frame"
      data-draw-wipe="x"
      className="pointer-events-none absolute inset-x-0 top-0 h-0"
      style={{ borderTop: '1px solid var(--ink-faint)' }}
    />
  );
}

/**
 * Training zoomed (L2): the six topics with their counts and tiers and, under
 * them, the kind mix with its key; beside them the plan's goals, each a
 * numbered title over its coverage line. A topic or a goal opens its full
 * detail. In the draw-in every topic and every goal is its own container: the
 * goals letter their titles side by side, each then running out its line.
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
      <section className="twd-topics flex min-h-0 flex-col gap-2" data-draw-scope="">
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
        <footer className="relative mt-auto flex flex-col gap-2 pt-3" data-draw-scope="">
          <TopRule />
          <Letter>{m.kinds}</Letter>
          <KindMixStrip mix={training.kindMix} legend />
        </footer>
      </section>
      <section className="flex min-h-0 flex-col gap-2" data-draw-scope="">
        <Letter>{m.goals}</Letter>
        {training.goals.length === 0 ? (
          <Write text={t.twin.blueprint.states.emptyTraining} className="typo-caption" />
        ) : (
          <ol className="flex flex-col gap-0.5">
            {training.goals.map((g, i) => (
              <li key={g.id}>
                <GoalLine goal={g} number={i + 1} onOpen={() => onOpen(g.id)} />
              </li>
            ))}
          </ol>
        )}
        <div className="relative mt-auto flex flex-wrap items-baseline gap-x-6 gap-y-1 pt-2">
          <TopRule />
          <Meta label={m.answers} value={training.answered} />
          <Meta label={m.observations} value={training.observations} />
          <span className="flex items-baseline gap-2" data-draw-scope="">
            <Letter>{m.lastTrained}</Letter>
            {training.lastTrainedAt ? (
              <span data-draw="write">
                <RelativeTime timestamp={training.lastTrainedAt} className="typo-body text-foreground" />
              </span>
            ) : (
              <Write text={m.neverTrained} className="typo-caption" />
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
    <span className="flex items-baseline gap-2" data-measured={value === null ? 'false' : 'true'} data-draw-scope="">
      <Letter>{label}</Letter>
      {value === null ? <Write text="-" className="typo-caption" /> : <WriteNumber value={value} className="typo-data text-foreground" />}
    </span>
  );
}

/** One goal: its number, its title in full (two lines at most), and its coverage drawn under it. */
function GoalLine({ goal, number, onOpen }: { goal: BlueprintGoal; number: number; onOpen: () => void }) {
  const cov = Math.min(1, Math.max(0, goal.coverage));
  const dropped = goal.state === 'dropped';
  const solid = !dropped && cov > 0;
  return (
    <PressRow label={goal.title} onPress={onOpen} className="flex items-start gap-3 px-1.5 py-1">
      <span data-goal={goal.id} data-state={goal.state} data-draw-scope="" className="contents">
        <Balloon number={number} inked={!dropped && cov > 0} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`line-clamp-2 typo-body text-foreground ${dropped ? 'line-through' : ''}`}>
            <Write text={goal.title} />
          </span>
          <span className="flex items-center gap-3">
            <span aria-hidden className="relative h-2.5 min-w-0 flex-1" style={{ border: '1px solid transparent' }}>
              <DrawFrame stroke={goal.state === 'covered' ? 'var(--ink)' : 'var(--ink-dim)'} dash={solid ? undefined : '4 3'} />
              {!dropped && <span data-draw="extend" className="absolute inset-y-0 left-0" style={{ width: `${cov * 100}%`, background: 'var(--ink)' }} />}
            </span>
            <WriteNumber value={cov} unit="ratio" precision={0} className="inline-block w-12 shrink-0 text-right typo-data text-foreground" />
          </span>
        </span>
      </span>
    </PressRow>
  );
}

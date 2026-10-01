/**
 * Training plate: one row per topic (approved answers solid, awaiting review
 * hatched, full at the covered tier), and one column per plan goal on the
 * right (height = coverage 0..1, a dropped goal dashed). No plan yet: the goal
 * block is hatched as not drawn.
 */
import type { TopicId, TwinBlueprintModel } from '../../../blueprintContract';
import { TOPIC_FULL_AT, share } from '../strataModel';
import { FaceSvg, Overflow, Unmeasured } from './FaceSvg';

const TRACK = { x: 6, w: 50 };
const ROW = 8;
const GOALS = { x: 66, w: 28, base: 54, rise: 46 };

export function TrainingFace({ model, hatch, hot }: { model: TwinBlueprintModel; hatch: string; hot: TopicId | null }) {
  const { topics, goals } = model.training;
  const slot = goals.length > 0 ? GOALS.w / goals.length : 0;
  return (
    <FaceSvg hatch={hatch}>
      {topics.map((topic, i) => {
        const y = 6 + i * ROW;
        const done = TRACK.w * share(topic.approved, TOPIC_FULL_AT);
        const withAwaiting = TRACK.w * share(topic.approved + topic.awaiting, TOPIC_FULL_AT);
        return (
          <g key={topic.id} className={hot === topic.id ? 'sf-hot' : undefined} data-topic={topic.id}>
            <rect className="sf-track" x={TRACK.x} y={y} width={TRACK.w} height={5} />
            <rect className="sf-ink" x={TRACK.x} y={y} width={done} height={5} />
            {withAwaiting > done && (
              <rect x={TRACK.x + done} y={y} width={withAwaiting - done} height={5} fill={`url(#${hatch})`} />
            )}
            {topic.approved > TOPIC_FULL_AT && <Overflow x={TRACK.x + TRACK.w} y={y} h={5} />}
          </g>
        );
      })}

      {goals.length === 0 ? (
        <Unmeasured hatch={hatch} x={GOALS.x} y={GOALS.base - GOALS.rise} w={GOALS.w} h={GOALS.rise} />
      ) : (
        goals.map((g, i) => {
          const x = GOALS.x + i * slot + slot * 0.18;
          const w = slot * 0.64;
          const h = GOALS.rise * Math.min(1, Math.max(0, g.coverage));
          if (g.state === 'dropped') {
            return <rect key={g.id} className="sf-dash" x={x} y={GOALS.base - GOALS.rise} width={w} height={GOALS.rise} />;
          }
          return (
            <g key={g.id}>
              <rect className="sf-track" x={x} y={GOALS.base - GOALS.rise} width={w} height={GOALS.rise} />
              <rect className="sf-ink" x={x} y={GOALS.base - h} width={w} height={h} />
            </g>
          );
        })
      )}
    </FaceSvg>
  );
}

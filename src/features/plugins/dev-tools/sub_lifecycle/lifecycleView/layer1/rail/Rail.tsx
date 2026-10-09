/**
 * The rail: the practice as a pipeline, two stacked lanes (before / after the
 * task) of equal cards joined by the pipe, each lane one row. One roving tab
 * stop walks both lanes in journey order (`StepTrack`); one peek serves every
 * card (`usePeek`), anchored under the card so it never covers a neighbour in
 * the same lane.
 */
import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';

import type { StepRoving } from '../../blocks/useStepRoving';
import { isUntracked, useTimeTravel } from '../../history/timeTravel';
import { useLifecycleViewModel } from '../../context';
import { Count } from '../../system/Count';
import { RAIL } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import type { HealthStep } from '../healthModel';
import { StepTrack, type Layer1Data } from '../useLayer1';
import { Lane } from './Lane';
import { NodeCard } from './NodeCard';
import { PeekBody } from './Peek';
import { usePeek, type PeekControl } from './usePeek';

function LaneOf({ title, steps, offset, testId, roving, peek, data }: {
  title: string;
  steps: HealthStep[];
  offset: number;
  testId: string;
  roving: StepRoving;
  peek: PeekControl;
  data: Pick<Layer1Data, 'measuring' | 'settled'>;
}) {
  const time = useTimeTravel();
  const travelOf = (id: string) => (time.viewing === null ? null : isUntracked(time, id) ? 'untracked' : 'then');
  return (
    <Lane label={title} head={<span className={LT.eyebrow}>{title}</span>} count={<Count value={steps.length} />} steps={steps.length} testId={testId}>
      {steps.map((s, i) => (
        <NodeCard
          key={s.node.id}
          step={s}
          upstream={steps[i - 1] ?? null}
          index={offset + i}
          roving={roving}
          peek={peek}
          measuring={data.measuring.get(s.node.id) ?? null}
          settle={data.settled.has(s.node.id)}
          travel={travelOf(s.node.id)}
        />
      ))}
    </Lane>
  );
}

export function Rail({ data }: { data: Layer1Data }) {
  const { dl } = useLifecycleViewModel();
  const { before, after, all, roving } = data;
  const { peek, control } = usePeek();
  const peeked = peek ? all.find((s) => s.node.id === peek.stepId) ?? null : null;
  return (
    <>
      <StepTrack roving={roving} className={RAIL.laneGap}>
        <LaneOf title={dl.lc_lane_before} steps={before} offset={0} testId="lc-lane-before" roving={roving} peek={control} data={data} />
        <LaneOf title={dl.lc_lane_after} steps={after} offset={before.length} testId="lc-lane-after" roving={roving} peek={control} data={data} />
      </StepTrack>
      <AnchoredTooltip anchor={peeked && peek ? peek.anchor : null} content={peeked ? <PeekBody step={peeked} /> : null} placement="bottom" />
    </>
  );
}

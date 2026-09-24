// The lane's running strip: grid on the left, finish line on the right, the
// runner where the seat is now. A racing seat's runner moves with elapsed
// time against the ceiling (one shared 1 s ticker; only racing lanes
// subscribe). Geometry via transform, never a formatted percent string.
import { Flag } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';

import { elapsedSince, lanePosition, laneStage, type LaneStage } from './arenaModel';
import { ARENA } from './copy';

const RUNNER_TONE: Record<LaneStage, string> = {
  grid: 'bg-status-neutral',
  racing: 'bg-status-processing',
  finished: 'bg-status-success',
  out: 'bg-status-warning',
};

export interface LaneTrackProps {
  state: ContestSeatState;
  wallS: number | null;
  /** Fleet session start (ms) when the Monitor store knows it. */
  startedAtMs: number | null;
  /** The seat ceiling in seconds, when reported. */
  ceilingS: number | null;
}

export function LaneTrack(props: LaneTrackProps) {
  return laneStage(props.state) === 'racing' ? <LiveLaneTrack {...props} /> : <StaticLaneTrack {...props} elapsedS={null} />;
}

function LiveLaneTrack(props: LaneTrackProps) {
  useFixedTicker(1000);
  const elapsedS = elapsedSince(props.startedAtMs, Date.now());
  return <StaticLaneTrack {...props} elapsedS={elapsedS} />;
}

function StaticLaneTrack({ state, wallS, ceilingS, elapsedS }: LaneTrackProps & { elapsedS: number | null }) {
  const stage = laneStage(state);
  const position = lanePosition(state, elapsedS, ceilingS, wallS);
  return (
    <div className="space-y-1" data-testid="arena-lane-track" data-stage={stage}>
      <div className="relative h-3">
        {/* the lane itself, with dashed lane markings */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-primary/20" />
        {/* distance covered */}
        <div
          className={`absolute left-0 top-1/2 h-0.5 w-full origin-left ${RUNNER_TONE[stage]} transition-transform duration-500 motion-reduce:transition-none`}
          style={{ transform: `translateY(-50%) scaleX(${position})` }}
        />
        {/* the runner */}
        <div className="absolute inset-0 transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `translateX(${position * 100}%)` }}>
          <span className={`absolute left-0 top-1/2 block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-pill ring-2 ring-background ${RUNNER_TONE[stage]}`} />
        </div>
        <Flag className="absolute -right-1 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-foreground" aria-hidden />
      </div>
      {stage === 'racing' && (
        <p className="typo-caption text-foreground">
          <Numeric value={elapsedS} unit="s" /> {ARENA.elapsed}
          {' · '}
          {ceilingS !== null ? ARENA.ofCeiling(Math.round(ceilingS / 60)) : ARENA.ceilingUnknown}
        </p>
      )}
    </div>
  );
}

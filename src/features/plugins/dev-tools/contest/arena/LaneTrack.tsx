// The lane's meter: three grid cells of the lane row — the thin track (grid on
// the left, finish flag on the right, the runner where the seat is now), the
// state word, and elapsed / ceiling. A racing seat's runner moves with
// elapsed time against the ceiling (one shared 1 s ticker; only racing lanes
// subscribe). Geometry via transform, never a formatted percent string.
import { Flag } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import type { StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';

import { elapsedSince, lanePosition, laneStage, type LaneStage } from './arenaModel';
import { ToneDot } from './ToneDot';

const wholeSeconds = (s: number | null) => (s === null ? null : Math.floor(s));

const RUNNER_TONE: Record<LaneStage, string> = {
  grid: 'bg-status-neutral',
  racing: 'bg-status-processing',
  finished: 'bg-status-success',
  out: 'bg-status-warning',
};

export interface LaneMeterProps {
  state: ContestSeatState;
  stateLabel: string;
  stateTone: StatusVariant;
  wallS: number | null;
  /** When the seat left the queue (ms), when known. */
  startedAtMs: number | null;
  /** The seat ceiling in seconds. */
  ceilingS: number | null;
}

export function LaneMeter(props: LaneMeterProps) {
  return laneStage(props.state) === 'racing' ? <LiveLaneMeter {...props} /> : <LaneMeterView {...props} elapsedS={props.wallS} />;
}

function LiveLaneMeter(props: LaneMeterProps) {
  useFixedTicker(1000);
  return <LaneMeterView {...props} elapsedS={wholeSeconds(elapsedSince(props.startedAtMs, Date.now()))} />;
}

function LaneMeterView({ state, stateLabel, stateTone, wallS, ceilingS, elapsedS }: LaneMeterProps & { elapsedS: number | null }) {
  const { t } = useTranslation();
  const a = t.plugins.contest.arena;
  const stage = laneStage(state);
  const position = lanePosition(state, stage === 'racing' ? elapsedS : null, ceilingS, wallS);
  return (
    <>
      <div className="relative h-3 min-w-0" data-testid="arena-lane-track" data-stage={stage}>
        {/* the lane itself */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary/10" />
        {/* distance covered */}
        <div
          className={`absolute left-0 top-1/2 h-0.5 w-full origin-left ${RUNNER_TONE[stage]} transition-transform duration-500 motion-reduce:transition-none`}
          style={{ transform: `translateY(-50%) scaleX(${position})` }}
        />
        {/* the runner */}
        <div className="absolute inset-0 transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `translateX(${position * 100}%)` }}>
          <span className={`absolute left-0 top-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-pill ring-2 ring-background ${RUNNER_TONE[stage]}`} />
        </div>
        <Flag className="absolute -right-1 top-1/2 w-3 h-3 -translate-y-1/2 text-foreground" aria-hidden />
      </div>
      <ToneDot tone={stateTone} className="min-w-0 text-foreground">
        <span className="truncate">{stateLabel}</span>
      </ToneDot>
      <span className="typo-data text-right whitespace-nowrap" aria-label={a.elapsed}>
        <Numeric value={elapsedS} unit="s" />
        <span className="typo-caption"> / </span>
        <span className="typo-caption">
          <Numeric value={ceilingS} unit="s" />
        </span>
      </span>
    </>
  );
}

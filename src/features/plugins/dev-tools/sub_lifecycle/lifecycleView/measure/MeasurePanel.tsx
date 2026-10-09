/**
 * THE MEASURE PANEL: a running Measure, command by command, in the status
 * band's slot at the head of Layer 1 (the band yields while the panel is open
 * and returns, re-judged, when it closes; `layer1/Layer1`). Its plate is
 * outlined in the accent while the Measure runs, the warning tone while it is
 * cancelling, and its result's tone once it ended.
 *
 * - preparing (the plan is resolving: worktree, commands): ghost columns, as
 *   many as the last Measure ran;
 * - running / cancelling: one column per command (`CommandRow`), in the order
 *   they run, left to right: the rail's lane language, two lines each;
 * - ended: what changed and the first failure (`EndedBody`), two lines. It
 *   stays `LINGER_MS` after the end, held open while a pointer rests on it or
 *   focus is inside it, or until dismissed.
 *
 * Every state fits inside the status band's own height (at 1280x800 the
 * rail's last line already sits on the fold, so the slot cannot grow).
 *
 * The header says the rest (the count and Cancel in the Measure control, the
 * time left in the subtitle), so the panel is all commands.
 */
import { useQuantizedNow } from '@/hooks/utility/timing/relativeTimeTicker';

import { useLifecycleViewModel } from '../context';
import { useTimeTravel } from '../history/timeTravel';
import { GhostLine } from '../system/GhostLine';
import { lcSurface } from '../system/lcSurface';
import { CommandRow, TILE_LINE } from './CommandRow';
import { EndedBody } from './EndedBody';
import { useMeasureSession, type MeasurePhase } from './measureSession';
import { useMeasureOutcome, type MeasureOutcome } from './useMeasureOutcome';

/** One equal column per command, in one row, like a lane of the rail. */
const lane = (n: number) => ({ gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` });
const LANE_CLASS = 'grid gap-x-5';
/** Columns to ghost while the plan resolves, when the last Measure says nothing. */
const GHOST_COLUMNS = 4;

function outline(phase: MeasurePhase, outcome: MeasureOutcome | null): string {
  if (phase === 'cancelling' || outcome?.cancelled) return 'border border-status-warning/50 bg-status-warning/5';
  if (outcome) return outcome.failures.length > 0 ? 'border border-status-error/50 bg-status-error/5' : 'border border-status-success/50 bg-status-success/5';
  return 'border border-primary/40 bg-primary/5';
}

function Rows() {
  const { progress } = useMeasureSession();
  const now = useQuantizedNow(1000);
  return (
    <ol className={LANE_CLASS} style={lane(progress?.commands.length ?? 0)} data-testid="lc-measure-rows">
      {(progress?.commands ?? []).map((c) => <CommandRow key={c.commandId} cmd={c} now={now} />)}
    </ol>
  );
}

function GhostRows() {
  const { columns } = useTimeTravel();
  const n = columns[columns.length - 1]?.runs.length || GHOST_COLUMNS;
  return (
    <div aria-hidden className={LANE_CLASS} style={lane(n)} data-testid="lc-measure-ghost">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="flex min-w-0 flex-col gap-1">
          <span className={TILE_LINE.command}><GhostLine role="code" width={`${60 + ((i * 17) % 30)}%`} /></span>
          <span className={TILE_LINE.state}><GhostLine role="label" width="80%" /></span>
        </span>
      ))}
    </div>
  );
}

export function MeasurePanel() {
  const { dl } = useLifecycleViewModel();
  const { phase, hold } = useMeasureSession();
  const outcome = useMeasureOutcome();
  return (
    <section
      aria-label={dl.lcx4_panel_label}
      className={lcSurface('plate', outline(phase, outcome))}
      onPointerEnter={() => hold(true)}
      onPointerLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(false); }}
      data-testid="lc-measure-panel"
      data-phase={phase}
    >
      {phase === 'preparing' ? <GhostRows /> : outcome ? <EndedBody outcome={outcome} /> : <Rows />}
    </section>
  );
}

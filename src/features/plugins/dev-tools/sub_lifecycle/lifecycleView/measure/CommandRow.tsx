/**
 * One command of a running Measure, as one column of the panel's lane (the
 * rail's own language: equal columns, read left to right in the order the
 * commands run). Two fixed lines, so every column is the same height:
 *
 * 1. its kind's glyph and the command (monospace, clipped, whole in a tooltip);
 * 2. where it stands and its time against its estimate -
 *    - waiting: an open dot and the estimate ("~1m 30s"), or "No estimate";
 *    - running: a bar filling toward its median with a streak sweeping it,
 *      and "40s of ~1m"; past 1.5x its median both turn to the warning tone
 *      (the tooltip says what is usual); with no median the bar is a dim
 *      streak and the time says there is no estimate (first run);
 *    - done: the run's outcome pill and how long it took.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { LifecycleCommandProgress } from '@/lib/bindings/LifecycleCommandProgress';
import { formatDuration } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { RunPill } from '../system/Pill';
import { GLYPH, METER } from '../system/scales';
import { KIND_GLYPH } from './kindGlyph';
import { elapsedMs, isOver } from './measureModel';
import { Streak } from './Streak';

/** A column's two lines, by name: shared with the panel's ghost columns. */
export const TILE_LINE = {
  command: 'flex h-6 min-w-0 items-center gap-2',
  state: 'flex h-7 min-w-0 items-center gap-2',
} as const;

function RunningBar({ cmd, now }: { cmd: LifecycleCommandProgress; now: number }) {
  const over = isOver(cmd, now);
  const ratio = cmd.medianMs ? Math.min(1, elapsedMs(cmd, now) / cmd.medianMs) : 1;
  return (
    <span aria-hidden className={`relative block min-w-6 flex-1 ${METER.track} rounded-pill bg-primary/15`} data-bar={over ? 'over' : 'running'}>
      <span
        className={`absolute inset-y-0 left-0 block rounded-pill ${over ? 'bg-status-warning' : 'bg-primary'} ${cmd.medianMs ? '' : 'opacity-40'}`}
        style={{ width: `${Math.round(ratio * 1000) / 10}%` }}
      />
      <Streak />
    </span>
  );
}

function RunningLine({ cmd, now }: { cmd: LifecycleCommandProgress; now: number }) {
  const { dl, tx } = useLifecycleViewModel();
  const elapsed = formatDuration(elapsedMs(cmd, now));
  const eta = cmd.medianMs != null ? formatDuration(cmd.medianMs) : null;
  const over = isOver(cmd, now);
  const said = eta ? tx(dl.lcx4_time_of, { elapsed, eta }) : tx(dl.lcx4_time_first, { elapsed });
  return (
    <>
      <span className="sr-only">{dl.lcx4_state_running}</span>
      <RunningBar cmd={cmd} now={now} />
      <Tooltip content={over && eta ? tx(dl.lcx4_time_over, { elapsed, eta }) : said} placement="bottom">
        <span className={`min-w-0 shrink truncate ${LT.metaNum} ${over ? 'text-status-warning' : ''}`} data-over={over || undefined}>{said}</span>
      </Tooltip>
    </>
  );
}

function StateLine({ cmd, now }: { cmd: LifecycleCommandProgress; now: number }) {
  const { dl, tx } = useLifecycleViewModel();
  if (cmd.state === 'running') return <RunningLine cmd={cmd} now={now} />;
  if (cmd.state === 'done' && cmd.outcome) {
    const took = cmd.outcome !== 'did_not_run' && cmd.durationMs != null ? formatDuration(cmd.durationMs) : null;
    return (
      <>
        <RunPill outcome={cmd.outcome} />
        {took && <span className={`truncate ${LT.metaNum}`}>{took}</span>}
      </>
    );
  }
  const eta = cmd.medianMs != null ? tx(dl.lcx4_eta, { eta: formatDuration(cmd.medianMs) }) : dl.lcx4_eta_none;
  return (
    <>
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-foreground/40" />
      {/* The word shows when the column has room; the open dot says it alone on a narrow one. */}
      <span className={`hidden shrink-0 ${LT.label} @[12rem]/tile:inline`}>{dl.lcx4_state_waiting}</span>
      <span className="sr-only @[12rem]/tile:hidden">{dl.lcx4_state_waiting}</span>
      <span className={`min-w-0 truncate ${LT.metaNum}`}>{eta}</span>
    </>
  );
}

export function CommandRow({ cmd, now }: { cmd: LifecycleCommandProgress; now: number }) {
  const Glyph = KIND_GLYPH[cmd.kind];
  const running = cmd.state === 'running';
  return (
    <li className="@container/tile flex min-w-0 flex-col gap-1" data-command={cmd.commandId} data-state={cmd.state}>
      <span className={TILE_LINE.command}>
        <Glyph className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden />
        <Tooltip content={cmd.command} placement="bottom">
          <span className={`min-w-0 truncate ${LT.code} ${running ? 'text-primary' : ''}`}>{cmd.command}</span>
        </Tooltip>
      </span>
      <span className={TILE_LINE.state}>
        <StateLine cmd={cmd} now={now} />
      </span>
    </li>
  );
}

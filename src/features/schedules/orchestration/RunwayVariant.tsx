// RunwayVariant — the DEPARTURE BOARD.
//
// Metaphor: a runway. One ordered column, big position numerals on the left
// like gate numbers, and the board is cut into bands by what the next tick
// does: STARTING NOW (the personas that take this tick's starts), WAITING (in
// order, out of budget), then HELD (refused by a rung) and NOTHING TO DO. A
// drag moves a whole row; the bands re-cut after the loop's own ladder
// re-derives the verdicts. Reads top-to-bottom as "who goes, then who's next".
//
// Differs from the Ledger (a table of every input) by showing the OUTCOME
// first and the inputs only on hover, and from the Slots board by keeping one
// axis: order is vertical, and nothing else competes with it.

import { Fragment } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { DragHandle } from '@/features/shared/components/display/DragHandle';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchOrderState } from './useDispatchOrder';
import { LaneChip, PersonaIdentity, RankMark, ReorderButtons, VerdictChip } from './parts';

type Band = 'starting' | 'waiting' | 'held' | 'idle';

function bandOf(row: DispatchPreviewRow): Band {
  switch (row.verdict.kind) {
    case 'dispatch':
      return 'starting';
    case 'waits_for_slot':
      return 'waiting';
    case 'refused':
      return 'held';
    default:
      return 'idle';
  }
}

const BAND_RAIL: Record<Band, string> = {
  starting: 'bg-status-success',
  waiting: 'bg-status-warning',
  held: 'bg-status-error/70',
  idle: 'bg-border',
};

function RunwayRow({ row, index, count, onMove }: { row: DispatchPreviewRow; index: number; count: number; onMove: DispatchOrderState['move'] }) {
  const { t, tx } = useTranslation();
  const s = t.schedules;
  const controls = useDragControls();
  const band = bandOf(row);
  return (
    <Reorder.Item
      value={row.personaId}
      dragListener={false}
      dragControls={controls}
      className="group relative flex items-center gap-3 rounded-card border border-border bg-secondary/10 py-2 pl-2 pr-3 shadow-elevation-1"
      data-testid={`runway-row-${row.personaId}`}
      data-band={band}
    >
      <span aria-hidden className={`absolute inset-y-2 left-0 w-1 rounded-full ${BAND_RAIL[band]}`} />
      <DragHandle reveal="always" size="md" onPointerDown={(e) => controls.start(e)} label={s.orch_reorder_aria} className="ml-1 cursor-grab touch-none" />
      <div className="w-14 flex-shrink-0 text-center">
        <RankMark rank={row.rank} position={row.position} big />
      </div>
      <div className="min-w-0 flex-1">
        <PersonaIdentity row={row} />
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 typo-caption text-foreground">
          <span>{tx(s.orch_interval, { minutes: row.intervalMinutes })}{row.selfPaced ? ` · ${s.orch_self_paced}` : ''}</span>
          <span>
            {s.orch_last_served}{' '}
            {row.lastServedAt ? <RelativeTime timestamp={row.lastServedAt} /> : s.orch_never_served}
          </span>
          <span>{tx(s.orch_charters, { count: row.charters })}</span>
        </div>
      </div>
      <LaneChip lane={row.lane} />
      <VerdictChip row={row} size="md" />
      <ReorderButtons id={row.personaId} first={index === 0} last={index === count - 1} onMove={onMove} />
    </Reorder.Item>
  );
}

function BandDivider({ band, count }: { band: Band; count: number }) {
  const { t } = useTranslation();
  const s = t.schedules;
  const label = { starting: s.orch_band_starting, waiting: s.orch_band_waiting, held: s.orch_band_held, idle: s.orch_band_idle }[band];
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className={`h-2 w-2 rounded-full ${BAND_RAIL[band]}`} aria-hidden />
      <span className="typo-label text-foreground">{label}</span>
      <span className="typo-label text-foreground opacity-60 tabular-nums">{count}</span>
      <span className="h-px flex-1 bg-border/60" aria-hidden />
    </div>
  );
}

export function RunwayVariant({ state }: { state: DispatchOrderState }) {
  const { t } = useTranslation();
  const { rows, reorder, move, saving } = state;
  const ids = rows.map((r) => r.personaId);
  // Bands are computed from the SHOWN order: a divider precedes the first row
  // whose band differs from the previous row's, so a dragged row that is
  // between verdicts still sits where the operator put it.
  const counts = rows.reduce<Record<Band, number>>((acc, r) => {
    acc[bandOf(r)] += 1;
    return acc;
  }, { starting: 0, waiting: 0, held: 0, idle: 0 });

  return (
    <div className="space-y-2" aria-busy={saving} data-testid="orchestration-runway">
      <Reorder.Group axis="y" values={ids} onReorder={reorder} className="space-y-2" aria-label={t.schedules.orch_reorder_aria}>
        {rows.map((row, i) => {
          const band = bandOf(row);
          const prev = i > 0 ? bandOf(rows[i - 1]!) : null;
          return (
            <Fragment key={row.personaId}>
              {band !== prev && <BandDivider band={band} count={counts[band]} />}
              <RunwayRow row={row} index={i} count={rows.length} onMove={move} />
            </Fragment>
          );
        })}
      </Reorder.Group>
    </div>
  );
}

export default RunwayVariant;

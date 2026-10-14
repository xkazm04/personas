// One lane of the Queue view, built as a BAY is (Bay.tsx): a plate whose
// nameplate carries the engraved lane name, its count, and a lamp lit with the
// worst state inside the lane, then the lane's sessions drawn as their states
// (the share bar), then the lines. Same vocabulary as a bay (`sessionBucket` ->
// `PERSONA_LAMP`), so "lit" means the same thing on both layouts: something in
// here works or needs the operator. A lane of queued or parked-clean sessions
// is a dark plate; a failed exit lights Parked red, an input wait lights its
// lane amber.
//
// WINDOWING. A lane is the one list on this surface that is genuinely
// unbounded - it is board-wide, not per-project, so "100+ concurrent
// automations" lands in Running as 100 lines. Above `VIRTUALIZE_ABOVE` a lane
// renders only what its scroller can show; below it, byte-for-byte the DOM it
// always rendered. `SessionLine` declares an exact `height`, so the size the
// virtualizer is handed is the size the row has.

import { useCallback, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import { VIRTUALIZE_ABOVE } from '../../gridGeometry';
import { SESSION_LINE_H } from './SessionLine';
import { Engraved, Lamp } from './parts';
import { PERSONA_LAMP, toneClass, type Lamp as LampModel } from './tone';
import { sessionBucket } from './boardFilter';

/** One windowed line of a lane: its key and the node to paint at that slot. */
export interface LaneRow {
  key: string;
  node: ReactNode;
}

/** The lane's own lamp: the most urgent session inside it (`bayLamp`'s rule). */
export function laneLamp(sessions: readonly FleetSession[]): LampModel {
  let worst: LampModel = PERSONA_LAMP.idle;
  for (const s of sessions) {
    const b = sessionBucket(s);
    if (b === 'failed') return PERSONA_LAMP.failed;
    if (b === 'attention') worst = PERSONA_LAMP.attention;
    else if (b === 'running' && worst.tone === 'off') worst = PERSONA_LAMP.running;
  }
  return worst;
}

/** The lane's sessions drawn as their states, under the nameplate (a bay's `ShareBar`). */
function LaneShare({ sessions }: { sessions: readonly FleetSession[] }) {
  const n: Record<SquareState, number> = { running: 0, attention: 0, failed: 0, idle: 0 };
  for (const s of sessions) n[sessionBucket(s)] += 1;
  return (
    <span className="ae-share mx-2" aria-hidden>
      {SQUARE_STATE_ORDER.filter((s) => n[s] > 0).map((s) => (
        <span key={s} className={toneClass(PERSONA_LAMP[s].tone)} style={{ flexGrow: n[s], opacity: s === 'idle' ? 0.35 : 1 }} />
      ))}
    </span>
  );
}

/** The nameplate alone: also the cold lane's chrome, so the first read lands in place. */
export function LaneHead({ title, count, sessions }: { title: string; count: number | null; sessions: readonly FleetSession[] }) {
  return (
    <>
      <header className="flex flex-shrink-0 items-center gap-2 py-2 pl-3.5 pr-2.5">
        <Engraved className="min-w-0 flex-1 truncate">{title}</Engraved>
        {count !== null && <span className="flex-shrink-0 typo-data tabular-nums text-foreground"><Numeric value={count} /></span>}
        <Lamp lamp={laneLamp(sessions)} />
      </header>
      <LaneShare sessions={sessions} />
    </>
  );
}

export function QueueLane({
  title, sessions, children, rows, empty, testId,
}: {
  title: string;
  /** Every session the lane holds: its count, lamp and share bar. */
  sessions: readonly FleetSession[];
  /** A lane whose body is not a plain list of lines (the queue ladder). */
  children?: ReactNode;
  /** A lane that IS a list of session lines, and may therefore be windowed. */
  rows?: LaneRow[];
  empty: string;
  testId: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const list = rows ?? [];
  const virtualize = list.length > VIRTUALIZE_ABOVE;
  // Exact, not an estimate: `SessionLine` sets `height: SESSION_LINE_H`.
  const estimateSize = useCallback(() => SESSION_LINE_H, []);
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 6,
  });

  let body: ReactNode;
  if (sessions.length === 0) {
    body = <p className="ae-well m-2 rounded-card px-3 py-5 text-center typo-body">{empty}</p>;
  } else if (!virtualize) {
    body = rows ? rows.map((r) => r.node) : children;
  } else {
    body = (
      <div className="relative w-full flex-shrink-0" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = list[v.index];
          if (!row) return null;
          return (
            <div key={row.key} data-row-key={row.key} className="absolute inset-x-0 top-0" style={{ height: v.size, transform: `translateY(${v.start}px)` }}>
              {row.node}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card" data-testid={testId}>
      <LaneHead title={title} count={sessions.length} sessions={sessions} />
      <div ref={parentRef} className="mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto" data-windowed={virtualize || undefined}>
        {body}
      </div>
    </section>
  );
}

// Lanes: the same sessions as three plates side by side - Running, Queued,
// Parked / done - each headed by its own lamp and count. Inside a lane every
// session is one compact two-row line (hairlines between, no box around), so a
// lane holds three times what a card column did. The lamp is lit only when the
// lane holds something; an empty lane is a dark plate at a glance.
//
// WINDOWING. A lane is the one list on this surface that is genuinely
// unbounded - it is board-wide, not per-project, so "100+ concurrent
// automations" lands in Running as 100 lines. Above `VIRTUALIZE_ABOVE` a lane
// renders only what its scroller can show; below it, byte-for-byte the DOM it
// always rendered. `SessionLine` declares an exact `height`, so unlike the
// Classic bays this needs no measure pass: the size the virtualizer is handed
// is the size the row has.
//
// The Queued lane is NOT windowed. It renders `QueueLadder`, which owns the
// drag-and-drop reorder and the ladder's own rails; a windowed list whose rows
// leave the DOM mid-drag is a different component, not a flag on this one.

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from '@/i18n/useTranslation';
import { useQuantizedNow } from '@/hooks/utility/timing/relativeTimeTicker';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ActivitySurface } from '../useActivitySurface';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { VIRTUALIZE_ABOVE } from '../../gridGeometry';
import { SessionLine, SESSION_LINE_H } from './SessionLine';
import { QueueLadder } from './QueueLadder';
import { SocketGhosts } from './Ghosts';
import { Engraved, Lamp } from './parts';
import type { Tone } from './tone';
import { isParked, type PanelFilter } from './boardFilter';
import type { WorkspaceScope } from './workspaceScope';
import { useAmbientMotionClass } from './useAmbientMotion';

const TICK_MS = 30_000;

const HOLDS: ReadonlySet<string> = new Set(['running', 'spawning', 'awaiting_input', 'idle']);

/** One windowed line of a lane: its key and the node to paint at that slot. */
interface LaneRow {
  key: string;
  node: ReactNode;
}

function Lane({
  title, count, tone, children, rows, empty, testId,
}: {
  title: string;
  count: number;
  tone: Tone;
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
  if (count === 0) {
    body = <p className="ae-well m-2 rounded-card px-3 py-5 text-center typo-caption">{empty}</p>;
  } else if (!virtualize) {
    body = rows ? rows.map((r) => r.node) : children;
  } else {
    body = (
      <div className="relative w-full flex-shrink-0" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = list[v.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              data-row-key={row.key}
              className="absolute inset-x-0 top-0"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
            >
              {row.node}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card" data-testid={testId}>
      <header className="flex flex-shrink-0 items-center gap-2.5 border-b border-border px-3 py-2">
        <Lamp lamp={{ tone, lit: count > 0 }} size="lg" />
        <Engraved>{title}</Engraved>
        <span className="ml-auto typo-data-lg tabular-nums text-foreground"><Numeric value={count} /></span>
      </header>
      <div ref={parentRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-windowed={virtualize || undefined}>
        {body}
      </div>
    </section>
  );
}

export function LanesPanel({
  surface, filter, workspaces, cap, onStart, onCancel,
}: {
  surface: ActivitySurface;
  filter: PanelFilter;
  /** The notepad's current sheet: which workspace's sessions these lanes hold. */
  workspaces: WorkspaceScope;
  cap: number;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  // One clock for the whole panel, moving only on the shared ticker — the
  // parked cut and the lines' ages now read the same instant, which three
  // separate `Date.now()` calls in render could not promise.
  const now = useQuantizedNow(TICK_MS);
  const motion = useAmbientMotionClass();
  const { queueModel: model, queueOrder: order, board, setTerminal, setRecap, focusKey, reducedMotion } = surface;

  const live = useMemo(() => model.running.filter((i) => !isParked(i.session, now)), [model.running, now]);
  const overIds = useMemo(() => {
    const holders = live.filter((i) => HOLDS.has(i.session.state));
    return new Set(cap > 0 ? holders.slice(cap).map((i) => i.sessionId) : []);
  }, [live, cap]);
  // A queue row reaches its workspace by either join the model already made:
  // the team the dispatch resolved to, or the project its cwd sits in.
  const inSheet = useCallback(
    (i: QueueItem) => workspaces.keepTeam(i.teamId) || workspaces.keepSession(i.session),
    [workspaces],
  );
  const running = live.filter((i) => filter.session(i.session) && inSheet(i));
  const queued = order.items.filter((i) => filter.session(i.session) && inSheet(i));
  const parked = useMemo(() => board.sessionList
    .filter((s) => isParked(s, now) && filter.session(s) && workspaces.keepSession(s))
    .sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs)),
  [board.sessionList, filter, workspaces, now]);

  const runningRows = running.map((item): LaneRow => ({
    key: item.sessionId,
    node: (
      <SessionLine key={item.sessionId} session={item.session} item={item} onOpen={setTerminal} onRecap={setRecap}
        flash={focusKey === `s:${item.sessionId}`} over={overIds.has(item.sessionId)} now={now} showProject />
    ),
  }));
  const parkedRows = parked.map((s): LaneRow => ({
    key: s.id,
    node: (
      <SessionLine key={s.id} session={s} onOpen={s.state === 'exited' ? undefined : setTerminal} onRecap={setRecap}
        flash={focusKey === `s:${s.id}`} now={now} showProject />
    ),
  }));

  if (surface.queueCold) {
    return <div className="flex min-h-0 flex-1 gap-3 p-3">{[0, 1, 2].map((i) => <div key={i} className="flex-1"><SocketGhosts count={3} /></div>)}</div>;
  }

  return (
    <div className={`flex min-h-0 flex-1 gap-2.5 overflow-hidden p-3 ${motion}`} data-testid="fleet-queue-lanes">
      <Lane title={m.queue_band_running} count={running.length} tone="run" empty={m.queue_empty_title} testId="fleet-queue-lane-running" rows={runningRows} />
      <Lane title={m.queue_band_queued} count={queued.length} tone="info" empty={m.queue_strip_empty} testId="fleet-queue-lane-queued">
        <QueueLadder order={order} items={queued} now={now} compact focusKey={focusKey} reducedMotion={reducedMotion} draggable={!filter.active} onStart={onStart} onCancel={onCancel} />
      </Lane>
      <Lane title={m.queue_lane_parked} count={parked.length} tone="ok" empty={m.queue_lane_parked} testId="fleet-queue-lane-parked" rows={parkedRows} />
    </div>
  );
}

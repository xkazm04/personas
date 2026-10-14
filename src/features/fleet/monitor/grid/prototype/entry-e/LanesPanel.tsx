// The Queue view: the same sessions as three plates side by side - Running,
// Queued, Parked / done - each built as a bay is (`QueueLane`): an engraved
// nameplate with its count and a lamp lit with the worst state inside, the
// share bar, then one compact two-row line per session (hairlines between, no
// box around), so a lane holds three times what a card column did. Activity's
// plate, lamp and card anatomy, so Bays and Queue read as one panel.
//
// The Queued lane is NOT windowed. It renders `QueueLadder`, which owns the
// drag-and-drop reorder and the ladder's own rails; a windowed list whose rows
// leave the DOM mid-drag is a different component, not a flag on this one.
//
// COLD: before the queue's first read the three plates and their nameplates
// are already in place, ghost lines where the sessions will land (loading
// pattern v2: chrome always renders, never a spinner).

import { useCallback, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useQuantizedNow } from '@/hooks/utility/timing/relativeTimeTicker';
import type { ActivitySurface } from '../useActivitySurface';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { SessionLine, SESSION_LINE_H } from './SessionLine';
import { QueueLadder } from './QueueLadder';
import { LaneHead, QueueLane, type LaneRow } from './QueueLane';
import { isParked, type PanelFilter } from './boardFilter';
import type { WorkspaceScope } from './workspaceScope';
import { useAmbientMotionClass } from './useAmbientMotion';

const TICK_MS = 30_000;

const HOLDS: ReadonlySet<string> = new Set(['running', 'spawning', 'awaiting_input', 'idle']);

/** The three plates at rest, nameplates on, before the first read lands. */
function ColdLanes({ titles }: { titles: string[] }) {
  return (
    <div className="flex min-h-0 flex-1 gap-2.5 overflow-hidden p-3" aria-hidden data-testid="fleet-queue-lanes-cold">
      {titles.map((title, i) => (
        <section key={title} className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card">
          <LaneHead title={title} count={null} sessions={[]} />
          <div className="mt-1 flex flex-col gap-1 px-1.5">
            {Array.from({ length: 3 - i }, (_, j) => <span key={j} className="ae-ghost rounded-card" style={{ height: SESSION_LINE_H }} />)}
          </div>
        </section>
      ))}
    </div>
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
    return <ColdLanes titles={[m.queue_band_running, m.queue_band_queued, m.queue_lane_parked]} />;
  }

  return (
    <div className={`flex min-h-0 flex-1 gap-2.5 overflow-hidden p-3 ${motion}`} data-testid="fleet-queue-lanes">
      <QueueLane title={m.queue_band_running} sessions={running.map((i) => i.session)} empty={m.queue_empty_title} testId="fleet-queue-lane-running" rows={runningRows} />
      <QueueLane title={m.queue_band_queued} sessions={queued.map((i) => i.session)} empty={m.queue_strip_empty} testId="fleet-queue-lane-queued">
        <QueueLadder order={order} items={queued} now={now} compact focusKey={focusKey} reducedMotion={reducedMotion} draggable={!filter.active} onStart={onStart} onCancel={onCancel} />
      </QueueLane>
      <QueueLane title={m.queue_lane_parked} sessions={parked} empty={m.queue_lane_parked} testId="fleet-queue-lane-parked" rows={parkedRows} />
    </div>
  );
}

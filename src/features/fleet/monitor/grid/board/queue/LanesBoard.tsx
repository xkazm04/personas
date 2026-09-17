// LanesBoard — three vertical lanes: Running | Queued | Parked / Done.
//
// A kanban read of the same fleet. Running holds the slot-holders (running,
// spawning, awaiting input, idle, stale — anything with a process); Queued is
// the reorder list (framer `Reorder`, axis y — drag the handle or use the
// arrows); Parked / Done holds what has stepped out of the cap's arithmetic:
// hibernated and finished rows, and rows that exited within the last hour, so
// a column that just drained is not a column that was never there. Older
// exits stay on the Fleet page, where the tail belongs.

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { buildQueueModel, type QueueItem } from './useQueueModel';
import { QueueTile } from './QueueTile';
import { QueueReorderList } from './QueueReorderList';
import type { QueueBoardProps } from './queueBoardTypes';

const PARKED_WINDOW_MS = 60 * 60 * 1_000;

function isParked(s: FleetSession, now: number): boolean {
  if (s.state === 'hibernated' || s.state === 'finished') return true;
  return s.state === 'exited' && now - Number(s.lastActivityMs) <= PARKED_WINDOW_MS;
}

function Lane({ title, count, children, testId }: { title: string; count: number; children: React.ReactNode; testId: string }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-card border border-border/60 bg-foreground/[0.01]" data-testid={testId}>
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1.5">
        <span className="typo-label text-foreground">{title}</span>
        <span className="typo-caption tabular-nums text-foreground opacity-60"><Numeric value={count} /></span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

export function LanesBoard({
  model, order, actions, sessions, teams, reducedMotion, focusKey, onOpenSession, onRecapSession,
}: QueueBoardProps) {
  const { t } = useTranslation();
  const s = t.monitor;
  const teamColor = useMemo(() => new Map(teams.map((tm) => [tm.id, tm.color])), [teams]);

  const running = useMemo(() => model.running.filter((i) => !isParked(i.session, Date.now())), [model.running]);
  // Parked rows are read from the registry, not the model: exited rows are
  // not "live" and the model drops them by design, but this lane wants the
  // last hour of them.
  const parked = useMemo(() => {
    const now = Date.now();
    const rows = sessions.filter((x) => isParked(x, now));
    return buildQueueModel(rows.map((x) => (x.state === 'exited' ? { ...x, state: 'finished' as const } : x)), null)
      .running.map((i) => ({ ...i, session: sessions.find((x) => x.id === i.sessionId) ?? i.session }))
      .sort((a, b) => Number(b.session.lastActivityMs) - Number(a.session.lastActivityMs));
  }, [sessions]);

  const spring = reducedMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 400, damping: 32 };
  const still = (item: QueueItem, over = false) => (
    <motion.div key={item.sessionId} layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`} transition={spring}>
      <QueueTile
        item={item}
        actions={actions}
        onOpen={item.session.state === 'exited' ? undefined : onOpenSession}
        onRecap={onRecapSession}
        overAdmitted={over}
        flash={focusKey === `s:${item.sessionId}`}
      />
    </motion.div>
  );

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3" data-testid="fleet-queue-lanes">
      <AnimatePresence initial={false}>
        <Lane title={s.queue_band_running} count={running.length} testId="fleet-queue-lane-running">
          {running.map((item, i) => still(item, model.cap > 0 && i >= model.cap))}
        </Lane>
        <Lane title={s.queue_band_queued} count={order.items.length} testId="fleet-queue-lane-queued">
          <QueueReorderList
            order={order}
            actions={actions}
            axis="y"
            reducedMotion={reducedMotion}
            focusKey={focusKey}
            onOpen={onOpenSession}
            onRecap={onRecapSession}
            ariaLabel={s.queue_reorder_aria}
            className="flex flex-col gap-1.5"
            accentFor={(item) => (item.teamId ? teamColor.get(item.teamId) : undefined)}
          />
        </Lane>
        <Lane title={s.queue_lane_parked} count={parked.length} testId="fleet-queue-lane-parked">
          {parked.map((item) => still(item))}
        </Lane>
      </AnimatePresence>
    </div>
  );
}

export default LanesBoard;

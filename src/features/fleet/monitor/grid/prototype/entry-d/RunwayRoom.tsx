// Runway: the rack, at full size. One bay per seat the cap allows, numbered
// as the console gauge numbers them; a free seat is an empty dashed bay; work
// admitted past the cap hangs below a warning rule, outside the rack. Under
// the rack, the waiting line in dispatch order, each wait drawn to scale.

import type { CSSProperties } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { QueueItem } from '../../board/queue/useQueueModel';
import type { ActivitySurface } from '../useActivitySurface';
import { useSessionFacts, type useQueueConfirm } from '../shared';
import { ageLabel, holdsSeat, seat, sessionLamp, useRoom } from './rackModel';
import { UnitRow } from './UnitRow';
import { QueueRow, QUEUE_ROW_H } from './QueueRow';

function Bay({ item, n, over, now, index }: { item: QueueItem; n: number; over: boolean; now: number; index: number }) {
  const { t } = useTranslation();
  const facts = useSessionFacts()(item.session, item);
  const { hot, setHot, openSession, recapSession, focusKey, motion, cap } = useRoom();
  const Origin = facts.OriginIcon;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openSession(item.session)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSession(item.session); } }}
      onMouseEnter={() => setHot(item.sessionId)}
      onMouseLeave={() => setHot(null)}
      aria-label={[seat(n), facts.label, facts.stateLabel, facts.project].filter(Boolean).join(', ')}
      data-lamp={sessionLamp(item.session.state)}
      data-over={over || undefined}
      data-testid="fleet-grid-session"
      className={`ed-bigbay ed-row group focus-ring flex cursor-pointer items-center gap-3 rounded-card px-3 py-2 ${motion ? 'ed-rise' : ''} ${
        hot === item.sessionId ? 'ring-1 ring-primary' : ''} ${focusKey === `s:${item.sessionId}` ? 'ed-flash' : ''}`}
      style={{ '--i': index } as CSSProperties}
    >
      <Tooltip content={`${seat(n)} / ${cap} · ${t.monitor.grid_session_recap_open}`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); recapSession(item.session); }}
          aria-label={t.monitor.grid_session_recap_open}
          data-testid="fleet-queue-recap"
          className={`focus-ring rounded-input px-0.5 typo-data-lg tabular-nums transition-colors hover:text-primary ${over ? 'text-status-warning' : 'text-foreground'}`}
        >
          {seat(n)}
        </button>
      </Tooltip>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="flex-shrink-0 truncate typo-body text-foreground">{facts.label}</span>
        <span className="flex min-w-0 flex-shrink-0 items-center gap-1.5 typo-caption">
          <span aria-hidden data-lamp={sessionLamp(item.session.state)} className="ed-lamp" />
          <span className="truncate">{facts.stateLabel} · {ageLabel(facts.startedAt, now)}</span>
        </span>
        <span className="flex min-w-0 flex-shrink-0 items-center gap-1.5 typo-caption">
          <Origin className="h-3 w-3 flex-shrink-0" aria-hidden />
          <span className="truncate">{[facts.originLabel, facts.project].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
    </div>
  );
}

export function RunwayGhost() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4" aria-hidden>
      <div className="ed-runway-bays">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="ed-bigbay rounded-card" data-lamp="free" />)}
      </div>
      {Array.from({ length: 4 }, (_, i) => <div key={i} className="ed-row" style={{ height: QUEUE_ROW_H }} />)}
    </div>
  );
}

export function WaitingLine({ surface, confirm, now, compact = false }: {
  surface: ActivitySurface;
  confirm: ReturnType<typeof useQueueConfirm>;
  now: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const items = surface.queueOrder.items;
  const maxWait = items.reduce((m, it) => Math.max(m, it.estimatedStartMs !== null ? it.estimatedStartMs - now : 0), 0);
  if (items.length === 0) return <p className="px-3 py-3 typo-body">{t.monitor.queue_strip_empty}</p>;
  return (
    <div role="list" aria-label={t.monitor.queue_reorder_aria}>
      {items.map((item, i) => (
        <QueueRow key={item.sessionId} item={item} rank={i + 1} first={i === 0} last={i === items.length - 1}
          maxWaitMs={maxWait} now={now} onNudge={surface.queueOrder.nudge} onStart={confirm.askStart} onCancel={confirm.askCancel} compact={compact} />
      ))}
    </div>
  );
}

export function RunwayRoom({ surface, confirm, now }: {
  surface: ActivitySurface;
  confirm: ReturnType<typeof useQueueConfirm>;
  now: number;
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { cap } = useRoom();
  if (surface.queueCold) return <RunwayGhost />;
  const running = surface.queueModel.running.filter((it) => holdsSeat(it.session.state));
  const unseated = surface.queueModel.running.filter((it) => !holdsSeat(it.session.state));
  const inRack = running.slice(0, cap);
  const outside = running.slice(cap);
  const free = Math.max(0, cap - inRack.length);
  const k = (key: string) => <kbd className="ed-kbd rounded-input typo-caption text-foreground">{key}</kbd>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4" data-testid="fleet-queue-runway">
      <section className="flex flex-col gap-2.5">
        <header className="flex items-baseline gap-3">
          <span className="typo-label text-foreground">{s.queue_band_running}</span>
          <span className="typo-data tabular-nums text-foreground">{running.length} / {cap}</span>
        </header>
        <div className="ed-runway-bays" data-testid="fleet-queue-running-band">
          {inRack.map((item, i) => <Bay key={item.sessionId} item={item} n={i + 1} over={false} now={now} index={i} />)}
          {Array.from({ length: free }, (_, i) => (
            <div key={`free-${i}`} className="ed-bigbay flex items-center gap-3 rounded-card p-3" data-lamp="free" data-testid="fleet-queue-free-slot">
              <span className="typo-data-lg tabular-nums">{seat(inRack.length + i + 1)}</span>
              <span className="typo-caption">{s.queue_slot_free}</span>
            </div>
          ))}
        </div>
        {outside.length > 0 && (
          <>
            <div className="mt-1 flex items-center gap-2 typo-caption text-status-warning">
              <span className="h-px flex-1 border-t border-dashed border-status-warning" aria-hidden />
              {s.queue_over_admitted}
              <span className="h-px flex-1 border-t border-dashed border-status-warning" aria-hidden />
            </div>
            <div className="ed-runway-bays">
              {outside.map((item, i) => <Bay key={item.sessionId} item={item} n={cap + i + 1} over now={now} index={i} />)}
            </div>
          </>
        )}
      </section>
      <section className="ed-chassis flex flex-col rounded-card" style={{ marginBottom: 0 }}>
        <header className="flex h-11 items-center gap-3 px-3">
          <span className="typo-label text-foreground">{s.queue_band_queued}</span>
          <span className="typo-data tabular-nums text-foreground">{surface.queueOrder.items.length}</span>
          <span className="ed-hide-sm ml-auto flex items-center gap-3 typo-caption">
            <span className="flex items-center gap-1">{k('Alt')}{k('↑')}{k('↓')}</span>
            <span className="flex items-center gap-1">{k('S')} {s.queue_start_now}</span>
            <span className="flex items-center gap-1">{k('Del')} {s.queue_cancel}</span>
          </span>
        </header>
        <WaitingLine surface={surface} confirm={confirm} now={now} />
      </section>
      {unseated.length > 0 && (
        <section className="ed-chassis flex flex-col rounded-card" style={{ marginBottom: 0 }} data-testid="entry-d-unseated">
          <header className="flex h-11 items-center gap-3 px-3">
            <span aria-hidden data-lamp="idle" className="ed-lamp" />
            <span className="typo-label text-foreground">{s.queue_lane_parked}</span>
            <span className="typo-data tabular-nums text-foreground">{unseated.length}</span>
          </header>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', columnGap: 12 }}>
            {unseated.map((it) => <UnitRow key={it.sessionId} session={it.session} item={it} now={now} />)}
          </div>
        </section>
      )}
    </div>
  );
}

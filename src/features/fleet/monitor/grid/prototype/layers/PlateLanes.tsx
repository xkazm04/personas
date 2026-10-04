// LANES, in the plate's language — the fleet's work as three columns.
//
// The projects view answers "where do I go". This answers the other question
// the Activity surface has always carried: "what is the machine actually doing
// with its slots right now". Same tone contract as the card (`--pl-tone` per
// lane), same rank-and-rail vocabulary, so switching between the two reads as
// one surface rather than two features.
//
// THE CAP IS DRAWN, not described. The running lane holds exactly `cap` places
// and an unfilled one is a dashed slot, so "four free" is something counted
// rather than computed. A row past the cap (a Start now) sits after the slots
// in the warning tone — it is running, it is over the line, and the lane's
// arithmetic should not hide that.

import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { QueueItem, QueueModel } from '../../board/queue/useQueueModel';
import './casesCards.css';

type Lane = 'running' | 'queued' | 'parked';

function LaneRow({
  item, rank, onOpen,
}: {
  item: QueueItem;
  rank?: number | null;
  onOpen?: (session: FleetSession) => void;
}) {
  const title = item.session.title || item.session.name || item.projectLabel;
  const body = (
    <>
      <span className="pl__rank typo-caption">{rank != null ? <Numeric value={rank} /> : ''}</span>
      <span className="pl__title typo-body text-foreground">{title}</span>
      <span className="pl__meta typo-caption">{item.projectLabel}</span>
    </>
  );
  if (!onOpen) return <span className="pl__row">{body}</span>;
  return (
    <Button
      variant="ghost"
      onClick={() => onOpen(item.session)}
      data-testid="plate-lane-row"
      className="pl__row"
    >
      {body}
    </Button>
  );
}

export function PlateLanes({
  model, sessions, onOpenSession,
}: {
  model: QueueModel;
  sessions: readonly FleetSession[];
  onOpenSession: (session: FleetSession) => void;
}) {
  const { t } = useTranslation();
  const cap = Math.max(0, model.cap);
  const inBand = model.running.slice(0, cap);
  const over = model.running.slice(cap);
  const free = Math.max(0, cap - inBand.length);

  // Parked is read from the registry rather than the model: an exited row is
  // not "live" and the model drops it by design, but this lane wants the tail.
  const parked = sessions.filter(
    (s) => s.state === 'hibernated' || s.state === 'finished' || s.state === 'exited',
  );

  const lanes: Array<{ id: Lane; label: string; count: number; body: React.ReactNode }> = [
    {
      id: 'running',
      label: t.monitor.queue_band_running,
      count: model.running.length,
      body: (
        <>
          {inBand.map((i) => <LaneRow key={i.sessionId} item={i} onOpen={onOpenSession} />)}
          {Array.from({ length: free }, (_, n) => (
            <span key={`free-${n}`} className="pl__free typo-caption">{t.monitor.queue_slot_free}</span>
          ))}
          {over.map((i) => <LaneRow key={i.sessionId} item={i} onOpen={onOpenSession} />)}
        </>
      ),
    },
    {
      id: 'queued',
      label: t.monitor.queue_band_queued,
      count: model.queued.length,
      body: model.queued.length === 0
        ? <span className="pl__empty typo-caption">{t.monitor.queue_strip_empty}</span>
        : <>{model.queued.map((i) => <LaneRow key={i.sessionId} item={i} rank={i.rank} />)}</>,
    },
    {
      id: 'parked',
      label: t.monitor.queue_lane_parked,
      count: parked.length,
      body: parked.length === 0
        ? <span className="pl__empty typo-caption">{t.monitor.queue_strip_empty}</span>
        : (
          <>
            {parked.slice(0, 40).map((s) => (
              <span key={s.id} className="pl__row">
                <span className="pl__rank typo-caption" />
                <span className="pl__title typo-body text-foreground">{s.title || s.name}</span>
                <span className="pl__meta typo-caption">
                  <RelativeTime timestamp={Number(s.lastActivityMs)} format="elapsed" />
                </span>
              </span>
            ))}
          </>
        ),
    },
  ];

  return (
    <div className="pl" data-testid="plate-lanes">
      {lanes.map((lane) => (
        <section key={lane.id} className="pl__lane" data-lane={lane.id} data-testid={`plate-lane-${lane.id}`}>
          <header className="pl__head">
            <span className="pl__dot" aria-hidden />
            <span className="typo-label text-foreground">{lane.label}</span>
            <span className="pl__count typo-caption tabular-nums"><Numeric value={lane.count} /></span>
          </header>
          <div className="pl__body">{lane.body}</div>
        </section>
      ))}
    </div>
  );
}

export default PlateLanes;

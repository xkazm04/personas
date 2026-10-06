/**
 * The board's lane labels: once the spine is pulled wide, each lane gets a
 * column head - its project (one bracket over the project's lanes), the run's
 * name, its state and for how long, and what it waits for. A run's name opens
 * its terminal; Athena's head reads her phase.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import Button from '@/features/shared/components/buttons/Button';
import { useSystemStore } from '@/stores/systemStore';
import { R5B_COPY as C } from './copy';
import { clusters, type Geometry } from './spineGeometry';
import { minutesAgo, type Lane, type LaneTone } from './timeModel';

const TONE_TEXT: Record<LaneTone, string> = {
  working: 'text-status-info',
  queued: 'text-foreground',
  idle: 'text-foreground',
  stale: 'text-status-error',
  gate: 'text-status-warning',
};

function openTerminal(id: string) {
  const sys = useSystemStore.getState();
  sys.fleetSetActiveSession(id);
  sys.fleetSetGridOpen(true);
}

function StateRow({ lane, now, athenaWord }: { lane: Lane; now: number; athenaWord: string }) {
  if (lane.project === null) {
    const gates = lane.marks.filter((m) => m.gate).length;
    return (
      <p className="typo-code text-primary">
        {athenaWord}
        {gates > 0 && <span className="block text-status-warning">{C.gatesShort(gates)}</span>}
      </p>
    );
  }
  // What it waits for is the key on its gate, on the axis below; the head says how long.
  return (
    <p className={`typo-code ${TONE_TEXT[lane.tone]} whitespace-nowrap`}>
      {C.laneState[lane.tone]} {C.ago(minutesAgo(now, lane.since))}
    </p>
  );
}

export function BoardHeader({ geom, now, athenaWord }: { geom: Geometry; now: number; athenaWord: string }) {
  const lanes = geom.shown;
  return (
    <>
      {clusters(lanes).map((c) => {
        const left = (geom.xs[c.from] ?? 0) - 12;
        const width = (c.to - c.from + 1) * geom.col - 8;
        return (
          <div key={`${c.project ?? 'athena'}-${c.from}`} className="absolute top-3 flex items-center gap-2" style={{ left, width }}>
            <span className={`typo-eyebrow shrink-0 ${c.project === null ? 'text-primary' : 'text-foreground'}`}>{c.project ?? C.athena}</span>
            <span className="h-px flex-1 r5b-rule" aria-hidden />
          </div>
        );
      })}
      {lanes.map((lane, i) => {
        const left = (geom.xs[i] ?? 0) - 12;
        const athena = lane.project === null;
        return (
          <div key={lane.id} className="absolute top-10 bottom-2 flex flex-col gap-1 pr-3" style={{ left, width: geom.col }}>
            {athena ? (
              <p className="typo-label text-foreground px-1">{lane.segs.length > 0 ? C.ops(lane.segs.length) : C.noOps}</p>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => lane.sessionId && openTerminal(lane.sessionId)}
                aria-label={C.openRun(lane.name)}
                className="!px-1 !py-0 !items-start text-left"
              >
                <span className="typo-label text-foreground line-clamp-3">{lane.name}</span>
              </Button>
            )}
            <div className="px-1 mt-auto">
              <StateRow lane={lane} now={now} athenaWord={athenaWord} />
            </div>
          </div>
        );
      })}
    </>
  );
}

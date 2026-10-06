/**
 * The lanes themselves, drawn on the axis: one hairline per run thread, its
 * segments styled by state (working solid, queued dotted, idle faint, stuck
 * dashed, waiting on you thick in the gate colour), notices as small diamonds,
 * and on Athena's heavier lane your asks (ticks) and her replies (dots). The
 * same drawing serves the slim spine and the widened board: only each lane's
 * `left` changes, and CSS carries it there.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { KIND_VAR } from '../../../tones';
import { depth, type Lane } from './timeModel';

const pct = (f: number) => `${f * 100}%`;

function LaneLine({ lane, x, now, live }: { lane: Lane; x: number; now: number; live: boolean }) {
  const athena = lane.project === null;
  const segs = athena ? [{ from: now - 3_600_000, to: now, tone: 'idle' as const }, ...lane.segs] : lane.segs;
  const reachesEdge = segs.some((s) => depth(now, s.from) >= 1);
  return (
    <div className={`r5b-lane${athena ? ' athena' : ''}`} style={{ left: x }} data-lane={lane.id}>
      {segs.map((s, i) => {
        const top = depth(now, s.to);
        const bottom = depth(now, s.from);
        if (bottom - top <= 0) return null;
        return <span key={i} className={`r5b-seg ${s.tone}`} style={{ top: pct(top), height: pct(bottom - top) }} />;
      })}
      {reachesEdge && <span className="r5b-older" aria-hidden />}
      {lane.beats.map((b, i) => (
        <span key={i} className={`r5b-beat ${b.who}`} style={{ top: pct(depth(now, b.at)) }} aria-hidden />
      ))}
      {lane.marks
        .filter((m) => !m.gate)
        .map((m) => (
          <span
            key={m.id}
            className="r5b-notice"
            style={{ top: pct(depth(now, m.at)), ['--c' as string]: m.kind === 'input' ? 'var(--status-warning)' : KIND_VAR[m.kind] }}
            aria-hidden
          />
        ))}
      {athena && lane.tone !== 'idle' && lane.segs.length > 0 && <span className={`r5b-head${live ? ' live' : ''}`} aria-hidden />}
    </div>
  );
}

export function SpineLanes({ lanes, xs, now, live }: { lanes: Lane[]; xs: number[]; now: number; live: boolean }) {
  return (
    <>
      {lanes.map((lane, i) => (
        <LaneLine key={lane.id} lane={lane} x={xs[i] ?? 0} now={now} live={live && lane.project === null} />
      ))}
    </>
  );
}

/** Scale: ticks every 5 minutes on the window side, majors every 15 (slim); grid lines with labels (board). */
export function SpineScale({ board, width, labelFor }: { board: boolean; width: number; labelFor: (m: number) => string }) {
  const marks = Array.from({ length: 13 }, (_, i) => i * 5);
  return (
    <>
      {marks.map((m) => {
        const major = m % 15 === 0;
        const top = pct(m / 60);
        if (board) {
          if (!major) return null;
          return (
            <span key={m} aria-hidden>
              <span className="r5b-grid" style={{ top, left: 56, width: width - 56 }} />
              <span className="absolute typo-code text-muted tabular-nums -translate-y-1/2 left-3" style={{ top }}>
                {labelFor(m)}
              </span>
            </span>
          );
        }
        return <span key={m} className={`r5b-tick${major ? ' major' : ''}`} style={{ top, width: major ? 8 : 4 }} aria-hidden />;
      })}
    </>
  );
}

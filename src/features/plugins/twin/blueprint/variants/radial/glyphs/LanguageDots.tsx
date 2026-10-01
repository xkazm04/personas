/**
 * Identity's language marks: one dot per language along a track arc, up to
 * LANGUAGE_MARKS, chevrons past the last. No language is a measured zero (a
 * dashed track), not a hatched one.
 */
import { Chevrons } from './primitives';
import { DEG_PER_PX } from './chevron';
import { type Band, type Pt, arcLength, arcPath, polar } from '../radialGeometry';

/** Where each of the first `slots` languages sits on the band. */
export function languageDotPositions(band: Band, count: number, slots: number): Pt[] {
  const step = (band.a1 - band.a0) / slots;
  const r = (band.r0 + band.r1) / 2;
  return Array.from({ length: Math.min(count, slots) }, (_, k) => polar(band.cx, band.cy, r, band.a0 + (k + 0.5) * step));
}

export function LanguageDots({ band, count, slots }: { band: Band; count: number; slots: number }) {
  const { cx, cy, r0, r1, a0, a1 } = band;
  const r = (r0 + r1) / 2;
  const dotR = Math.max(2.5, Math.min((r1 - r0) / 2, arcLength(r, (a1 - a0) / slots) * 0.3, 9));
  const dots = languageDotPositions(band, count, slots);
  return (
    <g data-testid="radial-languages" data-count={count}>
      <path className={count === 0 ? 'rd-line rd-dash-line' : 'rd-line'} d={arcPath(cx, cy, r, a0, a1)} />
      {dots.map((p, k) => (
        <circle key={k} className="rd-dot" cx={p.x} cy={p.y} r={dotR} />
      ))}
      {count > slots && <Chevrons cx={cx} cy={cy} r={r} deg={a1 + 2 * DEG_PER_PX(r)} size={Math.min(10, (r1 - r0) * 1.2)} dir="cw" />}
    </g>
  );
}

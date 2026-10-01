/**
 * The marks every radial glyph is built from: the two hatch patterns, the
 * overflow chevrons, a share arc on a declared domain, a row of tick slots and
 * a three-part composition arc. Quantities only, no text (labels are HTML at
 * full type size). `null` always draws the hatched, dashed "not measured"
 * state and carries `data-measured="false"` for tests, never an empty track.
 */
import { DEG_PER_PX, chevronPath } from './chevron';
import { type Band, arcPath, bandPath, sectorPath, spokePath } from '../radialGeometry';
import { clamp01, type MemoryParts } from '../radialModel';

export interface RadialIds {
  /** Neutral hatch: not measured. */
  hatch: string;
  /** Ink hatch: awaiting review. */
  await: string;
}

export const radialIds = (uid: string): RadialIds => ({ hatch: `${uid}-hatch`, await: `${uid}-await` });

export function RadialDefs({ ids }: { ids: RadialIds }) {
  return (
    <defs>
      <pattern id={ids.hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect className="rd-hatch-line" width="1.6" height="6" />
      </pattern>
      <pattern id={ids.await} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect className="rd-await-line" width="2" height="5" />
      </pattern>
    </defs>
  );
}

/** A band nobody measured: hatched, dashed edge, flagged. */
export function Unmeasured({ band, ids, testId }: { band: Band; ids: RadialIds; testId?: string }) {
  const d = bandPath(band);
  return (
    <g data-measured="false" data-testid={testId}>
      <path d={d} fill={`url(#${ids.hatch})`} fillRule="evenodd" />
      <path d={d} className="rd-dash" fillRule="evenodd" />
    </g>
  );
}

/** Two chevrons: the count runs past its declared domain. `dir` = outward or clockwise. */
export function Chevrons({ cx, cy, r, deg, size, dir }: { cx: number; cy: number; r: number; deg: number; size: number; dir: 'out' | 'cw' }) {
  const step = dir === 'out' ? size * 0.7 : size * 0.7 * DEG_PER_PX(r);
  return (
    <g className="rd-chevrons" data-overflow="true">
      <path d={chevronPath(cx, cy, r, deg, size, dir)} />
      <path d={chevronPath(cx, cy, dir === 'out' ? r + step : r, dir === 'cw' ? deg + step : deg, size, dir)} />
    </g>
  );
}

interface ShareArcProps {
  band: Band;
  /** `null` = not measured. */
  value: number | null;
  fullAt: number;
  ids: RadialIds;
  testId?: string;
}

/** One quantity on a declared domain as an arc filling clockwise across the band. */
export function ShareArc({ band, value, fullAt, ids, testId }: ShareArcProps) {
  if (value === null) return <Unmeasured band={band} ids={ids} testId={testId} />;
  const { cx, cy, r0, r1, a0, a1 } = band;
  const end = a0 + clamp01(value / fullAt) * (a1 - a0);
  const over = value > fullAt;
  return (
    <g data-measured="true" data-testid={testId} data-overflow={over ? 'true' : undefined}>
      <path className="rd-track" d={bandPath(band)} fillRule="evenodd" />
      {end > a0 && <path className="rd-fill" d={sectorPath(cx, cy, r0, r1, a0, end)} />}
      {end > a0 && <path className="rd-cap" d={arcPath(cx, cy, r1, a0, end)} />}
      {value > 0 && <path className="rd-pen" d={spokePath(cx, cy, r0 - 2, r1 + 2, end)} />}
      {over && <Chevrons cx={cx} cy={cy} r={(r0 + r1) / 2} deg={a1 + 2 * DEG_PER_PX((r0 + r1) / 2)} size={Math.min(10, r1 - r0)} dir="cw" />}
    </g>
  );
}

interface TickRingProps {
  band: Band;
  count: number | null;
  slots: number;
  ids: RadialIds;
  testId?: string;
}

/** One tick per unit up to `slots`, the free slots faint, chevrons past the last. */
export function TickRing({ band, count, slots, ids, testId }: TickRingProps) {
  if (count === null) return <Unmeasured band={band} ids={ids} testId={testId} />;
  const { cx, cy, r0, r1, a0, a1 } = band;
  const step = (a1 - a0) / slots;
  const on = Math.min(count, slots);
  return (
    <g data-measured="true" data-testid={testId} data-count={count}>
      {Array.from({ length: slots }, (_, k) => (
        <path key={k} className={k < on ? 'rd-tick' : 'rd-tick-free'} d={spokePath(cx, cy, r0, r1, a0 + (k + 0.5) * step)} />
      ))}
      {count > slots && <Chevrons cx={cx} cy={cy} r={(r0 + r1) / 2} deg={a1 + 2 * DEG_PER_PX((r0 + r1) / 2)} size={Math.min(10, r1 - r0)} dir="cw" />}
    </g>
  );
}

/** Approved (solid), awaiting (ink hatch) and rejected (dashed outline) as shares of one arc. */
export function CompositionArc({ band, parts, ids, testId }: { band: Band; parts: MemoryParts | null; ids: RadialIds; testId?: string }) {
  if (parts === null) return <Unmeasured band={band} ids={ids} testId={testId} />;
  const { cx, cy, r0, r1, a0, a1 } = band;
  if (parts.total === 0) {
    return <path className="rd-track" d={bandPath(band)} fillRule="evenodd" data-measured="true" data-testid={testId} data-total="0" />;
  }
  const span = a1 - a0;
  const e1 = a0 + (parts.approved / parts.total) * span;
  const e2 = e1 + (parts.pending / parts.total) * span;
  return (
    <g data-measured="true" data-testid={testId} data-total={parts.total}>
      <path className="rd-track" d={bandPath(band)} fillRule="evenodd" />
      {e1 > a0 && <path className="rd-fill" d={sectorPath(cx, cy, r0, r1, a0, e1)} />}
      {e1 > a0 && <path className="rd-cap" d={arcPath(cx, cy, r1, a0, e1)} />}
      {e2 > e1 && <path d={sectorPath(cx, cy, r0, r1, e1, e2)} fill={`url(#${ids.await})`} className="rd-await" />}
      {a1 > e2 && <path className="rd-reject" d={sectorPath(cx, cy, r0 + 1, r1 - 1, e2 + 0.6, a1)} />}
    </g>
  );
}

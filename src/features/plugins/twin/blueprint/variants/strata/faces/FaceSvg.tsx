/**
 * The drawing surface on a plate's top face: a 100 x 62 viewBox (the plate's
 * own aspect) that the plate's isometric transform lays flat. Quantities only,
 * no text: the labels live in the flat callouts beside the stack, at full type
 * size. `hatch` is the per-plate pattern id that draws "not measured".
 */
import type { ReactNode } from 'react';

export const FACE_W = 100;
export const FACE_H = 62;

export function FaceSvg({ hatch, children }: { hatch: string; children: ReactNode }) {
  return (
    <svg
      className="strata-face-svg"
      viewBox={`0 0 ${FACE_W} ${FACE_H}`}
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <defs>
        <pattern id={hatch} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="sf-hatch-line" width="1" height="3" />
        </pattern>
      </defs>
      {children}
    </svg>
  );
}

/** A "not measured" block: hatched, dashed edge, flagged for tests. */
export function Unmeasured({ hatch, x, y, w, h }: { hatch: string; x: number; y: number; w: number; h: number }) {
  return (
    <g data-measured="false">
      <rect x={x} y={y} width={w} height={h} fill={`url(#${hatch})`} />
      <rect className="sf-dash" x={x} y={y} width={w} height={h} />
    </g>
  );
}

/** Two small chevrons past a full bar: the count runs over its declared domain. */
export function Overflow({ x, y, h }: { x: number; y: number; h: number }) {
  const m = y + h / 2;
  return (
    <g className="sf-ink" data-overflow="true">
      <path d={`M${x + 1} ${y} L${x + 3} ${m} L${x + 1} ${y + h} Z`} />
      <path d={`M${x + 4} ${y} L${x + 6} ${m} L${x + 4} ${y + h} Z`} />
    </g>
  );
}

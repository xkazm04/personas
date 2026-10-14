import type { ReactNode } from 'react';

const TAU = Math.PI * 2;
const f = (n: number) => n.toFixed(1);

/** One shape of an engraved medallion: a tag, its attributes, and an optional stroke opacity. */
type Shape = ['circle', { r: number; cx?: number; cy?: number; o?: number; dash?: string }] | ['path', { d: string; o?: number; w?: number }];

const circle = (r: number, o?: number, dash?: string, cx?: number, cy?: number): Shape => ['circle', { r, o, dash, cx, cy }];
const path = (d: string, o?: number, w?: number): Shape => ['path', { d, o, w }];

/** One medallion per phase, drawn for it. Constants only: nothing here depends on data. */
const EMBLEMS: Record<string, () => Shape[]> = {
  brief: () => {
    let t = '';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      t += `M${f(Math.cos(a) * 36)} ${f(Math.sin(a) * 36)}L${f(Math.cos(a) * 43)} ${f(Math.sin(a) * 43)}`;
    }
    return [circle(8), circle(18, 0.75), circle(28, 0.6, '2 4'), circle(36, 0.7), path(t, 0.75), path('M0 -49V-45M-3 -47H3')];
  },
  explore: () => [
    circle(38, 0.7), circle(28, 0.5, '1.5 3.5'), path('M0 -47L6 -6L47 0L6 6L0 47L-6 6L-47 0L-6 -6Z'), circle(7),
    circle(2.2, undefined, undefined, 21, -21), circle(2.2, undefined, undefined, -21, 21), path('M-30 -30L-8 -8M30 30L8 8', 0.5),
  ],
  edit: () => [
    path('M40 0L20 34.6L-20 34.6L-40 0L-20 -34.6L20 -34.6Z'), path('M20 0L10 17.3L-10 17.3L-20 0L-10 -17.3L10 -17.3Z', 0.8),
    path('M40 0L20 0M20 34.6L10 17.3M-20 34.6L-10 17.3M-40 0L-20 0M-20 -34.6L-10 -17.3M20 -34.6L10 -17.3', 0.65), circle(3),
  ],
  verify: () => {
    let hx = '';
    let bl = '';
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 6;
      hx += `${i ? 'L' : 'M'}${f(Math.cos(a) * 21)} ${f(Math.sin(a) * 21)}`;
      bl += `M${f(Math.cos(a) * 21)} ${f(Math.sin(a) * 21)}L${f(Math.cos(a + 0.62) * 40)} ${f(Math.sin(a + 0.62) * 40)}`;
    }
    return [circle(40, 0.75), path(`${hx}Z`), path(bl, 0.6), path('M-11 1L-3 10L13 -9', undefined, 1.8)];
  },
  ship: () => {
    let sp = '';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      sp += `M${f(Math.cos(a) * 7)} ${f(Math.sin(a) * 7)}L${f(Math.cos(a) * 41)} ${f(Math.sin(a) * 41)}M${f(Math.cos(a) * 44.6 + 2.6)} ${f(Math.sin(a) * 44.6)}A2.6 2.6 0 1 0 ${f(Math.cos(a) * 44.6 - 2.6)} ${f(Math.sin(a) * 44.6)}`;
    }
    return [circle(25), circle(7), path(sp, 0.8)];
  },
};

const toNodes = (k: string, shapes: Shape[]): ReactNode[] =>
  shapes.map((s, i) => {
    const [tag, a] = s;
    return tag === 'circle'
      ? <circle key={`${k}${i}`} r={a.r} cx={a.cx} cy={a.cy} strokeOpacity={a.o} strokeDasharray={a.dash} />
      : <path key={`${k}${i}`} d={a.d} strokeOpacity={a.o} strokeWidth={a.w} />;
  });

// Five fixed medallions, built once when the chunk loads.
const NODES: Record<string, ReactNode[]> = Object.fromEntries(Object.entries(EMBLEMS).map(([k, build]) => [k, toNodes(k, build())]));
const shapesOf = (k: string): ReactNode[] => NODES[k] ?? NODES.ship!;

/** @param keys the station's phases (several when the data braids there) */
export function DialEmblem({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <svg className={className} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      {keys.map((k) => <g key={k}>{shapesOf(k)}</g>)}
    </svg>
  );
}

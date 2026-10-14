import type { CSSProperties } from 'react';
import type { Scene } from './useScene';

/** Per-instance SVG ids: two views on one page must not share a gradient. */
export function mapIds(uid: string) {
  const u = uid.replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    river: `ws${u}river`, spring: `ws${u}spring`, sea: `ws${u}sea`, light: `ws${u}light`, hatch: `ws${u}hatch`,
    soft: `ws${u}soft`, glow: `ws${u}glow`, reveal: `ws${u}reveal`, wait: (q: number) => `ws${u}wait${q}`,
  };
}
export type MapIds = ReturnType<typeof mapIds>;

const stop = (offset: string, color: string, opacity: number): { offset: string; style: CSSProperties } => ({
  offset,
  style: { stopColor: `var(${color})`, stopOpacity: opacity },
});

/** Gradients, the marsh hatch, the soft filters, the arrival clip and the wait labels' paths. */
export function MapDefs({ ids, scene, revealMs }: { ids: MapIds; scene: Scene; revealMs: number }) {
  const { g } = scene;
  const ox = g.xA - g.srcW;
  return (
    <defs>
      <linearGradient id={ids.river} x1="0" x2="1" y1="0" y2="0">
        <stop {...stop('0', '--accent', 0.62)} />
        <stop {...stop('.55', '--primary', 0.48)} />
        <stop {...stop('1', '--primary', 0.36)} />
      </linearGradient>
      <radialGradient id={ids.spring}>
        <stop {...stop('0', '--accent', 0.75)} />
        <stop {...stop('.45', '--primary', 0.25)} />
        <stop {...stop('1', '--primary', 0)} />
      </radialGradient>
      <linearGradient id={ids.sea} x1="0" x2="1">
        <stop {...stop('0', '--primary', 0)} />
        <stop {...stop('.35', '--primary', 0.07)} />
        <stop {...stop('1', '--primary', 0.13)} />
      </linearGradient>
      <radialGradient id={ids.light} cx=".2" cy=".1" r="1">
        <stop {...stop('0', '--accent', 0.07)} />
        <stop {...stop('.5', '--secondary', 0.1)} />
        <stop {...stop('1', '--background', 0)} />
      </radialGradient>
      <pattern id={ids.hatch} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="7" height="7" style={{ fill: 'var(--status-error)', fillOpacity: 0.1 }} />
        <line x1="0" y1="0" x2="0" y2="7" style={{ stroke: 'var(--status-error)', strokeOpacity: 0.55, strokeWidth: 1.6 }} />
        <circle cx="4.5" cy="3.5" r=".8" style={{ fill: 'var(--status-error)', fillOpacity: 0.7 }} />
      </pattern>
      <filter id={ids.soft} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" /></filter>
      <filter id={ids.glow} x="-20%" y="-50%" width="140%" height="200%">
        <feGaussianBlur stdDeviation="6" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <clipPath id={ids.reveal}>
        <rect
          className="ws-reveal-rect"
          x={ox}
          y={-g.H}
          width={g.W * 2}
          height={g.H * 3}
          style={{ transformOrigin: `${ox}px 0px`, animationDuration: `${revealMs}ms` }}
        />
      </clipPath>
      {scene.labels.waits.map((wt) => <path key={wt.q} id={ids.wait(wt.q)} d={wt.d} fill="none" />)}
    </defs>
  );
}

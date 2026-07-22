// DIRECTION 1 — "Archipelago": the project portfolio as a nautical chart.
// Civ-like organic islands on a deep sea, dotted shipping routes between
// integrated projects, serif cartographic typography, isoline contours.
// Semantic zoom: far = silhouettes + fixed-size screen-space labels;
// mid = core + status dots; near = full dimension hexes with tool names.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { FarLabels } from '../lib/FarLabels';
import { mix, SERIF } from '../lib/ink';
import { sceneBounds, zoomMode, type Island, type IslandEdge, type Scene } from '../lib/types';
import { useCanvasCamera } from '../lib/useCanvasCamera';
import { ArchipelagoIsland } from './ArchipelagoIsland';

export function MastermindArchipelago({ scene }: { scene: Scene }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, panning, fit, handlers } = useCanvasCamera(svgRef);
  const [hover, setHover] = useState<string | null>(null);
  const fitted = useRef(false);

  useLayoutEffect(() => {
    if (!fitted.current && scene.islands.length > 0) {
      fit(sceneBounds(scene.islands));
      fitted.current = true;
    }
  }, [scene.islands, fit]);

  const mode = zoomMode(cam.z);
  const bySlug = useMemo(() => new Map(scene.islands.map((i) => [i.slug, i])), [scene.islands]);
  // Hover focus: the hovered island and its integration neighbours stay lit.
  const lit = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of scene.edges) {
      if (e.from === hover) s.add(e.to);
      if (e.to === hover) s.add(e.from);
    }
    return s;
  }, [hover, scene.edges]);

  return (
    <svg
      ref={svgRef}
      {...handlers}
      data-testid="mastermind-canvas"
      className="absolute inset-0 w-full h-full select-none"
      style={{ touchAction: 'none', cursor: panning ? 'grabbing' : 'grab' }}
    >
      <defs>
        <radialGradient id="mm-sea" cx="32%" cy="22%" r="95%">
          <stop offset="0%" stopColor={mix('var(--primary)', 7, 'var(--background)')} />
          <stop offset="55%" stopColor="var(--background)" />
          <stop offset="100%" stopColor={mix('var(--secondary)', 45, 'var(--background)')} />
        </radialGradient>
        <filter id="mm-coast" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      <rect width="100%" height="100%" fill="url(#mm-sea)" />

      <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
        {scene.edges.map((e) => (
          <Route key={`${e.from}→${e.to}`} e={e} a={bySlug.get(e.from)} b={bySlug.get(e.to)} lit={hover === e.from || hover === e.to} />
        ))}
        {scene.islands.map((i) => (
          <ArchipelagoIsland key={i.slug} island={i} mode={mode} dimmed={lit !== null && !lit.has(i.slug)} onHover={setHover} />
        ))}
      </g>

      {mode === 'far' && <FarLabels islands={scene.islands} cam={cam} fontFamily={SERIF} />}
    </svg>
  );
}

/** A dotted shipping route between two integrated islands — bowed so parallel
 *  routes never stack, trimmed off the landmasses. */
function Route({ e, a, b, lit }: { e: IslandEdge; a?: Island; b?: Island; lit: boolean }) {
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(130, len * 0.12);
  const cx = (a.x + b.x) / 2 - (dy / len) * bow;
  const cy = (a.y + b.y) / 2 + (dx / len) * bow;
  return (
    <path
      d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
      fill="none"
      stroke={mix('var(--primary)', 60, 'var(--muted-foreground)')}
      strokeWidth={e.kind === 'relation' ? 3 : 2}
      strokeDasharray="0.5 11"
      strokeLinecap="round"
      opacity={lit ? 0.95 : 0.28 + e.strength * 0.15}
      style={{ transition: 'opacity 200ms ease' }}
    />
  );
}

// DIRECTION 4 (round 2, from Archipelago) — "Grid Board": each project is a
// rectangular component board (header + 4×2 dimension matrix) on the sea.
// The most logically composable structure; identity falls back to the
// counter-scaled banner below the header-legibility threshold.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { mix } from '../lib/ink';
import { Route } from '../lib/Route';
import { ZoomBadge } from '../lib/ZoomBadge';
import { sceneBounds, type VariantProps } from '../lib/types';
import { useCanvasCamera } from '../lib/useCanvasCamera';
import { BoardIsland } from './BoardIsland';

export function MastermindGridBoard({ scene, mode, onIslandMove, onIslandCommit }: VariantProps) {
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

  const bySlug = useMemo(() => new Map(scene.islands.map((i) => [i.slug, i])), [scene.islands]);
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
    <>
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
            <BoardIsland
              key={i.slug}
              island={i}
              z={cam.z}
              mode={mode}
              dimmed={lit !== null && !lit.has(i.slug)}
              onHover={setHover}
              onIslandMove={onIslandMove}
              onIslandCommit={onIslandCommit}
            />
          ))}
        </g>
      </svg>
      <ZoomBadge z={cam.z} />
    </>
  );
}

// DIRECTION 2 — "Command Grid": the portfolio as a tactical strategy map.
// A faint hex tessellation spans the world; each project is a crisp flat-top
// hex formation (command hex + dimension cells on adjacency spokes); links are
// straight supply lines with type tags; a corner HUD reads out zoom + counts.
// Mono uppercase identity throughout.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { FarLabels } from '../lib/FarLabels';
import { mix, MONO } from '../lib/ink';
import { sceneBounds, zoomMode, type Island, type IslandEdge, type Scene } from '../lib/types';
import { useCanvasCamera } from '../lib/useCanvasCamera';
import { GridIsland } from './GridIsland';

const COPY = { projects: 'PROJECTS', links: 'LINKS', zoom: 'ZOOM' };

// Background tessellation cell size (world units).
const S = 34;
const TILE_W = 3 * S;
const TILE_H = Math.sqrt(3) * S;
const tileHex = (cx: number, cy: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 * Math.PI) / 180;
    return `${(cx + S * Math.cos(a)).toFixed(2)},${(cy + S * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

export function MastermindCommandGrid({ scene }: { scene: Scene }) {
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
        style={{ touchAction: 'none', cursor: panning ? 'grabbing' : 'grab', background: 'var(--background)' }}
      >
        <defs>
          <pattern id="mm-hexgrid" width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse">
            <polygon points={tileHex(S / 2, 0)} fill="none" stroke={mix('var(--foreground)', 5)} strokeWidth={1} />
            <polygon points={tileHex(2 * S, TILE_H / 2)} fill="none" stroke={mix('var(--foreground)', 5)} strokeWidth={1} />
          </pattern>
        </defs>

        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
          {/* the tessellation lives in world space so it pans/zooms with the map */}
          <rect x={-8000} y={-8000} width={16000} height={16000} fill="url(#mm-hexgrid)" />
          {scene.edges.map((e) => (
            <SupplyLine key={`${e.from}→${e.to}`} e={e} a={bySlug.get(e.from)} b={bySlug.get(e.to)} mode={mode} lit={hover === e.from || hover === e.to} />
          ))}
          {scene.islands.map((i) => (
            <GridIsland key={i.slug} island={i} mode={mode} dimmed={lit !== null && !lit.has(i.slug)} onHover={setHover} />
          ))}
        </g>

        {mode === 'far' && <FarLabels islands={scene.islands} cam={cam} fontFamily={MONO} uppercase square />}
      </svg>

      {/* HUD readout — part of the map identity, not a toolbar */}
      <div
        className="absolute bottom-3 left-3 z-10 px-2.5 py-1.5 pointer-events-none"
        style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted-foreground)', background: mix('var(--background)', 75), border: `1px solid ${mix('var(--foreground)', 10)}` }}
      >
        {COPY.zoom} {Math.round(cam.z * 100)}% · {scene.islands.length} {COPY.projects} · {scene.edges.length} {COPY.links}
      </div>
    </>
  );
}

/** Straight supply line, trimmed off both formations; type tag at near zoom. */
function SupplyLine({ e, a, b, mode, lit }: { e: IslandEdge; a?: Island; b?: Island; mode: string; lit: boolean }) {
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const TRIM = 190;
  if (len < TRIM * 2) return null;
  const ux = dx / len, uy = dy / len;
  const x1 = a.x + ux * TRIM, y1 = a.y + uy * TRIM;
  const x2 = b.x - ux * TRIM, y2 = b.y - uy * TRIM;
  const stroke = mix('var(--primary)', 55, 'var(--muted-foreground)');
  return (
    <g style={{ transition: 'opacity 200ms ease' }} opacity={lit ? 0.95 : 0.3 + e.strength * 0.15}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={e.kind === 'relation' ? 2 : 1} strokeDasharray={e.kind === 'similarity' ? '10 8' : undefined} />
      {mode === 'near' && e.label && (
        <text
          x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}
          textAnchor="middle" fontSize={9} fontFamily={MONO} letterSpacing="0.14em"
          fill={mix('var(--foreground)', 55)}
          style={{ textTransform: 'uppercase', paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 4 }}
        >
          {e.label}
        </text>
      )}
    </g>
  );
}

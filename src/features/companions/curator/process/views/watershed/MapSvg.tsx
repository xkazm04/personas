import { memo, type Ref } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { MapDefs, type MapIds } from './MapDefs';
import { MapLabels, Settlements } from './MapMarks';
import { MapWater, Spring } from './MapWater';
import { f1 } from './noise';
import type { Scene } from './useScene';

interface Props {
  scene: Scene;
  ids: MapIds;
  /** Arrival length in ms; 0 draws the map at once. */
  revealMs: number;
  regionRef: Ref<SVGTextElement>;
  svgRef: Ref<SVGSVGElement>;
}

/**
 * The stylised map, drawn once per scene. It never re-renders on hover: focus is applied as data
 * attributes from outside (`focus.ts`), the region title's words are written there too (the mode, or
 * the focused station), and the moving water lives on the canvas above it.
 */
export const MapSvg = memo(function MapSvg({ scene, ids, revealMs, regionRef, svgRef }: Props) {
  const { t } = useTranslation();
  const w = t.companions.process.watershed;
  const { g } = scene;
  const regionY = g.Tz + (g.cy - g.srcW / 2 - g.Tz) * 0.62;
  return (
    <svg
      ref={svgRef}
      className="ws-map"
      width={g.W}
      height={g.H}
      viewBox={`0 0 ${g.W} ${g.H}`}
      role="img"
      aria-label={w.map_aria}
    >
      <MapDefs ids={ids} scene={scene} revealMs={revealMs} />
      <g aria-hidden="true">
        <rect x={-g.W} y={-g.H} width={g.W * 3} height={g.H * 3} fill={`url(#${ids.light})`} />
        <path d={scene.graticule} className="ws-graticule" />
        <path d={scene.relief.regular} className="ws-contour" />
        <path d={scene.relief.index} className="ws-contour is-index" />
      </g>
      <text
        ref={regionRef}
        className="ws-region"
        x={f1(g.xA + (g.xB - g.xA) / 2)}
        y={f1(regionY)}
        textAnchor="middle"
        fontSize={f1(Math.max(12, Math.min(120 * g.U, (g.cy - g.Tz) * 0.62)))}
        aria-hidden="true"
      />
      {scene.ghost && (
        <g aria-hidden="true">
          <path d={scene.ghost.top} className="ws-ghost" />
          <path d={scene.ghost.bottom} className="ws-ghost" />
        </g>
      )}
      <MapWater scene={scene} ids={ids} />
      <Spring scene={scene} ids={ids} />
      <MapLabels scene={scene} ids={ids} arriving={revealMs > 0} />
      <Settlements scene={scene} ids={ids} />
    </svg>
  );
});

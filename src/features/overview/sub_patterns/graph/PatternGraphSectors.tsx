// VARIANT — Sectors. An orrery: faint concentric ring guides, each area OWNS
// an angular wedge sized by how much it knows, hex keystones on the inner
// ring. Round 2 made it a DRILL-DOWN: the overview is rings + keystones +
// territory tints only, and clicking a keystone (or its wedge) flies the
// camera into that slice of the sky while its clusters fan across the outer
// shells. The wedge stays the mental model — "frontend lives there" — and the
// tint brightens to mark the focused territory.
import { Fragment, useMemo } from 'react';

import { areaGraphTheme } from './graphTheme';
import { nodeRadius } from './graphModel';
import { NodeLabel } from './GraphChrome';
import { lod } from './useGraphCanvas';
import type { GraphVariantProps } from './PatternGraphNexus';

const RING_KEYSTONE = 190;
const RING_SHELLS = [320, 425];
const RING_OUTER = 470;
const GAP = 0.045; // radians between wedges

interface Wedge {
  start: number;
  end: number;
  mid: number;
}

function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${Math.cos(a) * r} ${Math.sin(a) * r}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${p(r0, a0)}`,
    `A ${r0} ${r0} 0 ${large} 1 ${p(r0, a1)}`,
    `L ${p(r1, a1)}`,
    `A ${r1} ${r1} 0 ${large} 0 ${p(r1, a0)}`,
    'Z',
  ].join(' ');
}

export default function PatternGraphSectors({
  graph,
  k,
  workspaceName,
  hoverArea,
  focusArea,
  selectedTopic,
  onHoverArea,
  onFocusArea,
  onSelectCluster,
}: GraphVariantProps) {
  const zoomVis = lod(k, 1.0, 1.45);
  const countLod = lod(k, 1.3, 1.8);

  // Wedge widths ∝ cluster count, floored so an empty area keeps a visible
  // sliver of territory instead of vanishing from the map.
  const wedges = useMemo<Wedge[]>(() => {
    const weights = graph.areas.map((a) => 1.6 + a.clusters.length);
    const totalW = weights.reduce((n, w) => n + w, 0);
    const usable = 2 * Math.PI - GAP * graph.areas.length;
    let cursor = -Math.PI / 2;
    return weights.map((w) => {
      const span = (w / totalW) * usable;
      const wedge = { start: cursor, end: cursor + span, mid: cursor + span / 2 };
      cursor += span + GAP;
      return wedge;
    });
  }, [graph.areas]);

  return (
    <g>
      {/* Ring guides — the astrolabe's engraving. */}
      {[RING_KEYSTONE, ...RING_SHELLS].map((r) => (
        <circle key={r} r={r} fill="none" stroke="var(--border)" strokeOpacity={0.35} strokeWidth={1} />
      ))}

      {graph.areas.map((area, i) => {
        const wedge = wedges[i] ?? { start: 0, end: 0.1, mid: 0.05 };
        const theme = areaGraphTheme(area.area);
        const empty = area.count === 0;
        const focused = focusArea === area.area;
        const hot = hoverArea === area.area || focused;
        const dim = focusArea ? !focused : hoverArea !== null && hoverArea !== area.area;
        const vis = focused ? 1 : focusArea ? 0 : zoomVis;
        const kx = Math.cos(wedge.mid) * RING_KEYSTONE;
        const ky = Math.sin(wedge.mid) * RING_KEYSTONE;
        const aR = nodeRadius(area.count, 17, 2, 34);
        const Icon = theme.icon;
        const flyTarget = {
          x: Math.cos(wedge.mid) * 295,
          y: Math.sin(wedge.mid) * 295,
          k: 1.3,
        };

        // Clusters flow across shell 0 then shell 1, evenly inside the wedge
        // with edge padding so neighbours never kiss across the gap.
        const perShell = Math.max(1, Math.ceil(area.clusters.length / RING_SHELLS.length));
        const placed = area.clusters.map((cl, j) => {
          const shellIdx = Math.floor(j / perShell);
          const idx = j % perShell;
          const inShell = Math.min(perShell, area.clusters.length - shellIdx * perShell);
          const pad = (wedge.end - wedge.start) * 0.12;
          const a0 = wedge.start + pad;
          const a1 = wedge.end - pad;
          const a = inShell > 1 ? a0 + (idx / (inShell - 1)) * (a1 - a0) : wedge.mid;
          const r = RING_SHELLS[Math.min(shellIdx, RING_SHELLS.length - 1)] ?? RING_SHELLS[0]!;
          return { cl, x: Math.cos(a) * r, y: Math.sin(a) * r };
        });

        return (
          <g key={area.area} opacity={dim ? 0.2 : 1} className="transition-opacity duration-300">
            {/* Sector territory tint — also a drill-down door. */}
            <path
              d={arcPath(130, RING_OUTER, wedge.start, wedge.end)}
              fill={theme.deep}
              fillOpacity={hot ? 0.1 : empty ? 0.015 : 0.045}
              stroke="none"
              className="cursor-pointer transition-[fill-opacity] duration-200"
              onPointerEnter={() => onHoverArea(area.area)}
              onPointerLeave={() => onHoverArea(null)}
              onClick={(e) => {
                e.stopPropagation();
                onFocusArea(area.area, flyTarget);
              }}
            />

            {placed.map(({ cl, x, y }, j) => {
              const cR = nodeRadius(cl.count, 6.5, 2.6, 20);
              const isSel = selectedTopic === cl.topic;
              return (
                <Fragment key={cl.topic}>
                  <g
                    style={{
                      opacity: vis,
                      transition: 'opacity 240ms ease',
                      transitionDelay: focused ? `${Math.min(j * 22, 330)}ms` : '0ms',
                      pointerEvents: vis < 0.4 ? 'none' : 'auto',
                    }}
                  >
                    <line x1={kx} y1={ky} x2={x} y2={y} stroke={theme.hex} strokeOpacity={0.18} strokeWidth={1} />
                    <g
                      transform={`translate(${x},${y})`}
                      className="cursor-pointer"
                      onPointerEnter={() => onHoverArea(area.area)}
                      onPointerLeave={() => onHoverArea(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCluster(cl);
                      }}
                    >
                      {isSel && <circle r={cR + 5} fill="none" stroke={theme.hex} strokeWidth={1.5} />}
                      {cl.pending > 0 && (
                        <circle r={cR + 2.5} fill="none" stroke={theme.hex} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
                      )}
                      <circle r={cR} fill={theme.deep} fillOpacity={0.28} stroke={theme.hex} strokeWidth={1.25} />
                      <NodeLabel
                        k={k}
                        dy={cR + 13}
                        text={cl.cluster}
                        sub={countLod > 0.02 ? `${cl.count}` : undefined}
                        fill={theme.hex}
                        size={11}
                      />
                    </g>
                  </g>
                </Fragment>
              );
            })}

            {/* Keystone — hexagonal, the PoE notable, the drill-down door. */}
            <g
              transform={`translate(${kx},${ky})`}
              className="cursor-pointer"
              onPointerEnter={() => onHoverArea(area.area)}
              onPointerLeave={() => onHoverArea(null)}
              onClick={(e) => {
                e.stopPropagation();
                onFocusArea(area.area, flyTarget);
              }}
            >
              <polygon
                points={hexPoints(aR)}
                fill={theme.deep}
                fillOpacity={empty ? 0.06 : focused ? 0.32 : 0.2}
                stroke={theme.hex}
                strokeOpacity={empty ? 0.3 : 0.9}
                strokeWidth={focused ? 2.5 : 1.75}
              />
              <Icon x={-8} y={-8} width={16} height={16} color={theme.hex} opacity={empty ? 0.4 : 0.95} pointerEvents="none" />
              <NodeLabel
                k={k}
                dy={aR + 16}
                text={area.area}
                sub={empty ? undefined : `${area.count}${area.pending > 0 ? ` · ${area.pending} pending` : ''}`}
                fill={theme.hex}
                opacity={empty ? 0.45 : 1}
                size={13}
                weight={600}
              />
            </g>
          </g>
        );
      })}

      {/* Hub. */}
      <g pointerEvents="none">
        <circle r={46} fill="var(--secondary)" fillOpacity={0.75} stroke="var(--border)" strokeWidth={1.5} />
        <text textAnchor="middle" y={-2} fill="var(--foreground)" fontSize={12.5} fontWeight={600} className="select-none">
          {workspaceName.length > 12 ? `${workspaceName.slice(0, 11)}…` : workspaceName}
        </text>
        <text textAnchor="middle" y={15} fill="var(--foreground)" opacity={0.55} fontSize={11} className="select-none tabular-nums">
          {graph.total}
        </text>
      </g>
    </g>
  );
}

function hexPoints(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${Math.cos(a) * r},${Math.sin(a) * r}`;
  }).join(' ');
}

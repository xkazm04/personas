// VARIANT — Nebula. A star map, not a wheel: areas are galaxy cores scattered
// on a deterministic golden-angle spiral (no reshuffling between sessions),
// clusters condense around their core in phyllotaxis, and a soft tinted glow
// marks each galaxy's gravity well. Curved trade routes tie every core back to
// a small nexus. The organic PoE outer-rim feel — least symmetric, most
// atmospheric, and the layout that degrades most gracefully when one area
// grows 10× the others: its galaxy just gets brighter and denser.
import { Fragment } from 'react';

import { areaGraphTheme } from './graphTheme';
import { nodeRadius } from './graphModel';
import { hashJitter, NodeLabel } from './GraphChrome';
import { lod } from './useGraphCanvas';
import type { GraphVariantProps } from './PatternGraphNexus';

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ≈137.5°

function galaxyPos(i: number, area: string): { x: number; y: number } {
  // Golden-angle spiral spaces galaxies without collisions at any count; a
  // hash-seeded jitter keeps the field from reading as a mathematical spiral.
  const r = 170 * Math.sqrt(i + 1.35);
  const a = i * GOLDEN + hashJitter(area) * 0.5;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export default function PatternGraphNebula({
  graph,
  k,
  workspaceName,
  hoverArea,
  selectedTopic,
  onHoverArea,
  onSelectCluster,
}: GraphVariantProps) {
  const clusterLod = lod(k, 0.55, 0.95);
  const countLod = lod(k, 1.25, 1.8);

  return (
    <g>
      <defs>
        {graph.areas.map((area) => {
          const theme = areaGraphTheme(area.area);
          return (
            <radialGradient key={area.area} id={`nebula-${area.area}`}>
              <stop offset="0%" stopColor={theme.deep} stopOpacity={0.16} />
              <stop offset="70%" stopColor={theme.deep} stopOpacity={0.05} />
              <stop offset="100%" stopColor={theme.deep} stopOpacity={0} />
            </radialGradient>
          );
        })}
      </defs>

      {/* Trade routes underneath everything. */}
      {graph.areas.map((area, i) => {
        const { x, y } = galaxyPos(i, area.area);
        const theme = areaGraphTheme(area.area);
        // Quadratic curve bowed perpendicular to the chord — a lane, not a spoke.
        const mx = x / 2 - y * 0.14;
        const my = y / 2 + x * 0.14;
        return (
          <path
            key={area.area}
            d={`M 0 0 Q ${mx} ${my} ${x} ${y}`}
            fill="none"
            stroke={theme.hex}
            strokeOpacity={area.count === 0 ? 0.07 : 0.18}
            strokeWidth={area.count === 0 ? 0.75 : 1.25}
          />
        );
      })}

      {graph.areas.map((area, i) => {
        const { x: gx, y: gy } = galaxyPos(i, area.area);
        const theme = areaGraphTheme(area.area);
        const empty = area.count === 0;
        const dim = hoverArea !== null && hoverArea !== area.area;
        const coreR = nodeRadius(area.count, 16, 2.1, 34);
        const glowR = 70 + area.clusters.length * 9;
        const Icon = theme.icon;

        return (
          <g key={area.area} opacity={dim ? 0.18 : 1} className="transition-opacity duration-200">
            {!empty && <circle cx={gx} cy={gy} r={glowR} fill={`url(#nebula-${area.area})`} pointerEvents="none" />}

            {area.clusters.map((cl, j) => {
              // Phyllotaxis around the core: dense centre, airy rim.
              const cr = 40 + 15 * Math.sqrt(j + 1);
              const ca = j * GOLDEN + hashJitter(cl.topic) * 0.9;
              const cx = gx + Math.cos(ca) * cr;
              const cy = gy + Math.sin(ca) * cr;
              const cR = nodeRadius(cl.count, 6, 2.6, 20);
              const isSel = selectedTopic === cl.topic;
              return (
                <Fragment key={cl.topic}>
                  <line x1={gx} y1={gy} x2={cx} y2={cy} stroke={theme.hex} strokeOpacity={0.2} strokeWidth={0.9} />
                  <g
                    transform={`translate(${cx},${cy})`}
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
                    <circle r={cR} fill={theme.deep} fillOpacity={0.3} stroke={theme.hex} strokeWidth={1.2} />
                    <NodeLabel
                      k={k}
                      dy={cR + 13}
                      text={cl.cluster}
                      sub={countLod > 0.02 ? `${cl.count}` : undefined}
                      fill={theme.hex}
                      opacity={clusterLod}
                      size={11}
                    />
                  </g>
                </Fragment>
              );
            })}

            {/* Galaxy core. */}
            <g
              transform={`translate(${gx},${gy})`}
              className="cursor-pointer"
              onPointerEnter={() => onHoverArea(area.area)}
              onPointerLeave={() => onHoverArea(null)}
            >
              <circle
                r={coreR}
                fill={theme.deep}
                fillOpacity={empty ? 0.06 : 0.22}
                stroke={theme.hex}
                strokeOpacity={empty ? 0.3 : 0.9}
                strokeWidth={1.75}
              />
              <Icon x={-8} y={-8} width={16} height={16} color={theme.hex} opacity={empty ? 0.4 : 0.95} pointerEvents="none" />
              <NodeLabel
                k={k}
                dy={coreR + 16}
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

      {/* Nexus beacon. */}
      <g pointerEvents="none">
        <circle r={26} fill="var(--secondary)" fillOpacity={0.8} stroke="var(--primary)" strokeOpacity={0.5} strokeWidth={1.25} />
        <text textAnchor="middle" y={-1} fill="var(--foreground)" fontSize={10.5} fontWeight={600} className="select-none">
          {workspaceName.length > 9 ? `${workspaceName.slice(0, 8)}…` : workspaceName}
        </text>
        <text textAnchor="middle" y={12} fill="var(--foreground)" opacity={0.55} fontSize={9.5} className="select-none tabular-nums">
          {graph.total}
        </text>
      </g>
    </g>
  );
}

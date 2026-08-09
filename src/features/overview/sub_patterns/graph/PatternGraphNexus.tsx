// VARIANT — Nexus. The PoE core: one crest at the centre, fifteen spokes to
// area keystones at fixed compass positions, clusters clumped in two orbital
// shells around their keystone. Hub-and-spoke: every path reads centre → area
// → cluster, and the empty areas stay on the wheel as dim sockets so the
// geography never reshuffles. Scales by letting each keystone's clump grow
// locally — distant clumps stay small on screen until you lean in.
import { Fragment } from 'react';

import { areaGraphTheme } from './graphTheme';
import { nodeRadius, type ClusterNode, type TopicGraph } from './graphModel';
import { NodeLabel } from './GraphChrome';
import { lod } from './useGraphCanvas';

export interface GraphVariantProps {
  graph: TopicGraph;
  k: number;
  workspaceName: string;
  hoverArea: string | null;
  selectedTopic: string | null;
  onHoverArea: (area: string | null) => void;
  onSelectCluster: (node: ClusterNode) => void;
}

const AREA_R = 330;
const CLUSTER_R1 = 96;
const CLUSTER_R2 = 148;

export default function PatternGraphNexus({
  graph,
  k,
  workspaceName,
  hoverArea,
  selectedTopic,
  onHoverArea,
  onSelectCluster,
}: GraphVariantProps) {
  const n = graph.areas.length;
  const clusterLod = lod(k, 0.55, 0.95);
  const countLod = lod(k, 1.25, 1.8);

  return (
    <g>
      {graph.areas.map((area, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const ax = Math.cos(angle) * AREA_R;
        const ay = Math.sin(angle) * AREA_R;
        const theme = areaGraphTheme(area.area);
        const empty = area.count === 0;
        const dim = hoverArea !== null && hoverArea !== area.area;
        const aR = nodeRadius(area.count, 20, 2.2, 40);
        const Icon = theme.icon;

        return (
          <g key={area.area} opacity={dim ? 0.22 : 1} className="transition-opacity duration-200">
            {/* Spoke: crest → keystone. */}
            <line
              x1={Math.cos(angle) * 56}
              y1={Math.sin(angle) * 56}
              x2={ax - Math.cos(angle) * aR}
              y2={ay - Math.sin(angle) * aR}
              stroke={theme.hex}
              strokeOpacity={empty ? 0.12 : 0.3}
              strokeWidth={empty ? 1 : 1.5 + Math.min(area.count / 18, 2.5)}
            />

            {/* Clusters: two alternating shells fanned outward from the keystone. */}
            {area.clusters.map((cl, j) => {
              // Even indices fill the inner shell, odd the outer, each shell a
              // symmetric fan facing outward from the crest. Interleaving the
              // shells half a slot apart keeps big families from self-overlap.
              const inner = j % 2 === 0;
              const shell = inner ? CLUSTER_R1 : CLUSTER_R2;
              const shellLen = inner
                ? Math.ceil(area.clusters.length / 2)
                : Math.floor(area.clusters.length / 2);
              const idx = Math.floor(j / 2);
              const spread = Math.min(2.6, 0.55 * shellLen);
              const t = shellLen > 1 ? idx / (shellLen - 1) - 0.5 : 0;
              const ca = angle + t * spread + (inner ? 0 : spread * 0.09);
              const cx = ax + Math.cos(ca) * shell;
              const cy = ay + Math.sin(ca) * shell;
              const cR = nodeRadius(cl.count, 7, 2.6, 22);
              const isSel = selectedTopic === cl.topic;
              return (
                <Fragment key={cl.topic}>
                  <line
                    x1={ax}
                    y1={ay}
                    x2={cx}
                    y2={cy}
                    stroke={theme.hex}
                    strokeOpacity={0.22}
                    strokeWidth={1}
                  />
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
                    {isSel && (
                      <circle r={cR + 5} fill="none" stroke={theme.hex} strokeWidth={1.5} strokeOpacity={0.9} />
                    )}
                    {cl.pending > 0 && (
                      <circle r={cR + 2.5} fill="none" stroke={theme.hex} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
                    )}
                    <circle r={cR} fill={theme.deep} fillOpacity={0.28} stroke={theme.hex} strokeWidth={1.25} />
                    <NodeLabel
                      k={k}
                      dy={cR + 14}
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

            {/* Area keystone. */}
            <g
              transform={`translate(${ax},${ay})`}
              className="cursor-pointer"
              onPointerEnter={() => onHoverArea(area.area)}
              onPointerLeave={() => onHoverArea(null)}
            >
              <circle r={aR + 6} fill={theme.deep} fillOpacity={empty ? 0.03 : 0.08} />
              <circle
                r={aR}
                fill={theme.deep}
                fillOpacity={empty ? 0.06 : 0.2}
                stroke={theme.hex}
                strokeOpacity={empty ? 0.3 : 0.9}
                strokeWidth={1.75}
              />
              <Icon
                x={-9}
                y={-9}
                width={18}
                height={18}
                color={theme.hex}
                opacity={empty ? 0.4 : 0.95}
                pointerEvents="none"
              />
              <NodeLabel
                k={k}
                dy={aR + 18}
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

      {/* Central crest. */}
      <g pointerEvents="none">
        <circle r={52} fill="var(--secondary)" fillOpacity={0.75} stroke="var(--border)" strokeWidth={1.5} />
        <circle r={44} fill="none" stroke="var(--primary)" strokeOpacity={0.35} strokeWidth={1} />
        <text textAnchor="middle" y={-2} fill="var(--foreground)" fontSize={13} fontWeight={600} className="select-none">
          {workspaceName.length > 14 ? `${workspaceName.slice(0, 13)}…` : workspaceName}
        </text>
        <text textAnchor="middle" y={16} fill="var(--foreground)" opacity={0.55} fontSize={11} className="select-none tabular-nums">
          {graph.total}
        </text>
      </g>
    </g>
  );
}

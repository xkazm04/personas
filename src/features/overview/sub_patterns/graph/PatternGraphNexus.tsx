// VARIANT — Nexus. The PoE core: one crest at the centre, fifteen spokes to
// area keystones at fixed compass positions. Round 2 made it a DRILL-DOWN:
// the overview shows only crest + keystones (first level of categorization),
// and clicking a keystone flies the camera in Google-Maps style while that
// area's clusters unfold in two orbital shells. Free wheel-zoom crosses the
// same reveal threshold naturally, so both paths — click and lean-in — land
// in the same detailed sky. Everything else stays dim until you fly back.
import { Fragment } from 'react';

import { areaGraphTheme } from './graphTheme';
import { nodeRadius, type ClusterNode, type TopicGraph } from './graphModel';
import { NodeLabel } from './GraphChrome';
import { lod } from './useGraphCanvas';

export interface FlyTarget {
  x: number;
  y: number;
  k: number;
}

export interface GraphVariantProps {
  graph: TopicGraph;
  k: number;
  workspaceName: string;
  hoverArea: string | null;
  focusArea: string | null;
  selectedTopic: string | null;
  /** Project lens: topics with an ADOPTED cell for the selected project keep
   *  their colour; everything else goes grey. `null` = whole workspace. */
  appliedTopics: ReadonlySet<string> | null;
  /** Completion traceability, 0..1 per `area/cluster` topic — the resolved
   *  share of the adoption matrix (adopted or skipped-as-inapplicable).
   *  `null` = nothing to trace against; no rings are drawn. */
  topicCoverage: ReadonlyMap<string, number> | null;
  /** Same, aggregated per area (drawn on the keystones). */
  areaCoverage: ReadonlyMap<string, number> | null;
  onHoverArea: (area: string | null) => void;
  onFocusArea: (area: string, target: FlyTarget) => void;
  onSelectCluster: (node: ClusterNode) => void;
}

/** Theme-aware grey for the project lens's "not applied here" state. */
const LENS_GREY = 'var(--muted-foreground)';

/** Progress ring on a node's border — the completion-traceability readout.
 *  A faint full track plus an arc from 12 o'clock, both counter-rotated to
 *  nothing (SVG dasharray on a circle), sized just outside the node body. */
function CoverageRing({ r, pct, hex }: { r: number; pct: number; hex: string }) {
  const C = 2 * Math.PI * r;
  return (
    <g transform="rotate(-90)" pointerEvents="none">
      <circle r={r} fill="none" stroke={hex} strokeOpacity={0.15} strokeWidth={2} />
      {pct > 0 && (
        <circle
          r={r}
          fill="none"
          stroke={hex}
          strokeOpacity={0.9}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(pct, 0.02) * C} ${C}`}
        />
      )}
    </g>
  );
}

const AREA_R = 330;
const CLUSTER_R1 = 96;
const CLUSTER_R2 = 148;

export default function PatternGraphNexus({
  graph,
  k,
  workspaceName,
  hoverArea,
  focusArea,
  selectedTopic,
  appliedTopics,
  topicCoverage,
  areaCoverage,
  onHoverArea,
  onFocusArea,
  onSelectCluster,
}: GraphVariantProps) {
  const n = graph.areas.length;
  // Free-zoom reveal: leaning past ~105% starts unfolding every area's
  // clusters even without a click — the "scroll" half of the drill-down.
  const zoomVis = lod(k, 1.05, 1.5);
  const countLod = lod(k, 1.35, 1.9);

  return (
    <g>
      {graph.areas.map((area, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const ax = Math.cos(angle) * AREA_R;
        const ay = Math.sin(angle) * AREA_R;
        const theme = areaGraphTheme(area.area);
        const empty = area.count === 0;
        const focused = focusArea === area.area;
        const dim = focusArea ? !focused : hoverArea !== null && hoverArea !== area.area;
        const vis = focused ? 1 : focusArea ? 0 : zoomVis;
        const aR = nodeRadius(area.count, 20, 2.2, 40);
        const Icon = theme.icon;
        // Project lens: an area keeps its colour if ANY of its clusters is
        // adopted by the selected project.
        const lensOn = appliedTopics !== null;
        const areaApplied = !lensOn || area.clusters.some((c) => appliedTopics.has(c.topic));
        const areaHex = areaApplied ? theme.hex : LENS_GREY;
        const areaDeep = areaApplied ? theme.deep : LENS_GREY;
        const areaMute = areaApplied ? 1 : 0.45;

        return (
          <g key={area.area} opacity={dim ? 0.22 : 1} className="transition-opacity duration-300">
            {/* Spoke: crest → keystone. */}
            <line
              x1={Math.cos(angle) * 56}
              y1={Math.sin(angle) * 56}
              x2={ax - Math.cos(angle) * aR}
              y2={ay - Math.sin(angle) * aR}
              stroke={areaHex}
              strokeOpacity={(empty ? 0.12 : 0.3) * areaMute}
              strokeWidth={empty ? 1 : 1.5 + Math.min(area.count / 18, 2.5)}
            />

            {/* Clusters unfold on focus (or free zoom): two alternating shells
                fanned outward, staggered so the dimension opens like a hand. */}
            {vis > 0.01 &&
              area.clusters.map((cl, j) => {
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
                const clApplied = !lensOn || appliedTopics.has(cl.topic);
                const clHex = clApplied ? theme.hex : LENS_GREY;
                const clDeep = clApplied ? theme.deep : LENS_GREY;
                const clMute = clApplied ? 1 : 0.45;
                return (
                  <Fragment key={cl.topic}>
                    <g
                      style={{
                        opacity: vis * clMute,
                        transition: 'opacity 240ms ease',
                        transitionDelay: focused ? `${Math.min(j * 22, 330)}ms` : '0ms',
                        pointerEvents: vis < 0.4 ? 'none' : 'auto',
                      }}
                    >
                      <line x1={ax} y1={ay} x2={cx} y2={cy} stroke={clHex} strokeOpacity={0.22} strokeWidth={1} />
                      <g
                        transform={`translate(${cx},${cy})`}
                        className="cursor-pointer"
                        onPointerEnter={() => onHoverArea(area.area)}
                        onPointerLeave={() => onHoverArea(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Leaf of the tree — opens the patterns modal.
                          onSelectCluster(cl);
                        }}
                      >
                        {isSel && (
                          <circle r={cR + 7} fill="none" stroke={clHex} strokeWidth={1.5} strokeOpacity={0.9} />
                        )}
                        {cl.pending > 0 && (
                          <circle r={cR + 5.5} fill="none" stroke={clHex} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
                        )}
                        <circle r={cR} fill={clDeep} fillOpacity={0.28} stroke={clHex} strokeWidth={1.25} />
                        {topicCoverage && (
                          <CoverageRing r={cR + 3} pct={topicCoverage.get(cl.topic) ?? 0} hex={clHex} />
                        )}
                        <NodeLabel
                          k={k}
                          dy={cR + 14}
                          text={cl.cluster}
                          sub={countLod > 0.02 ? `${cl.count}` : undefined}
                          fill={clHex}
                          size={11}
                        />
                      </g>
                    </g>
                  </Fragment>
                );
              })}

            {/* Area keystone — the drill-down door. */}
            <g
              transform={`translate(${ax},${ay})`}
              className="cursor-pointer"
              onPointerEnter={() => onHoverArea(area.area)}
              onPointerLeave={() => onHoverArea(null)}
              onClick={(e) => {
                e.stopPropagation();
                // Centre the clicked keystone; k=1.5 is where the cluster fan
                // (next level) is fully readable. Host toggles back out if
                // already focused.
                onFocusArea(area.area, { x: ax, y: ay, k: 1.5 });
              }}
            >
              <circle r={aR + 6} fill={areaDeep} fillOpacity={(empty ? 0.03 : 0.08) * areaMute} />
              <circle
                r={aR}
                fill={areaDeep}
                fillOpacity={(empty ? 0.06 : focused ? 0.32 : 0.2) * areaMute}
                stroke={areaHex}
                strokeOpacity={(empty ? 0.3 : 0.9) * areaMute}
                strokeWidth={focused ? 2.5 : 1.75}
              />
              {areaCoverage && !empty && (
                <CoverageRing r={aR + 4.5} pct={areaCoverage.get(area.area) ?? 0} hex={areaHex} />
              )}
              <Icon
                x={-9}
                y={-9}
                width={18}
                height={18}
                color={areaHex}
                opacity={(empty ? 0.4 : 0.95) * areaMute}
                pointerEvents="none"
              />
              <NodeLabel
                k={k}
                dy={aR + 18}
                text={area.area}
                sub={empty ? undefined : `${area.count}${area.pending > 0 ? ` · ${area.pending} pending` : ''}`}
                fill={areaHex}
                opacity={(empty ? 0.45 : 1) * areaMute}
                size={13}
                weight={600}
                pinned
              />
            </g>
          </g>
        );
      })}

      {/* Central crest. The title rides the same pinned counter-scale as the
          keystone labels (Mastermind idiom) so it reads at every zoom; the
          rings stay geometric. */}
      <g pointerEvents="none">
        <circle r={52} fill="var(--secondary)" fillOpacity={0.75} stroke="var(--border)" strokeWidth={1.5} />
        <circle r={44} fill="none" stroke="var(--primary)" strokeOpacity={0.35} strokeWidth={1} />
        <g transform={`scale(${Math.min(2.6, Math.max(0.8, 1 / k))})`}>
          <text textAnchor="middle" y={-2} fill="var(--foreground)" fontSize={13} fontWeight={600} className="select-none">
            {workspaceName.length > 14 ? `${workspaceName.slice(0, 13)}…` : workspaceName}
          </text>
          <text textAnchor="middle" y={16} fill="var(--foreground)" opacity={0.55} fontSize={11} className="select-none tabular-nums">
            {graph.total}
          </text>
        </g>
      </g>
    </g>
  );
}

// The topic graph — Nexus, the consolidated winner of the /prototype rounds.
// One crest at the centre, fifteen spokes to area keystones at fixed compass
// positions, clusters unfolding in two orbital shells on drill-down
// (Google-Maps flight; free wheel-zoom crosses the same reveal threshold).
// Geometry lives in `computeNexusLayout` so the pattern-edge links layer and
// the node layer read the SAME positions instead of duplicating the math.
import { Fragment, useMemo } from 'react';

import { areaGraphTheme } from './graphTheme';
import {
  nodeRadius,
  type ClusterLink,
  type ClusterNode,
  type FacetNode,
  type TopicGraph,
} from './graphModel';
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
  /** Aggregated cross-cluster pattern connections (fabric S2). Drawn ONLY
   *  inside a focused dimension — cross-branch curves at overview zoom are
   *  the hairball that kills every knowledge graph. */
  clusterLinks: readonly ClusterLink[];
  /** Second drill level: the cluster whose third-level topics are unfolded. */
  focusCluster: string | null;
  onHoverArea: (area: string | null) => void;
  onFocusArea: (area: string, target: FlyTarget) => void;
  /** Cluster WITH facets — drill in (fly + unfold the topic ring). */
  onFocusCluster: (node: ClusterNode, target: FlyTarget) => void;
  /** Leaf without facets — open the pattern stack. */
  onSelectCluster: (node: ClusterNode) => void;
  /** Third-level topic — open its pattern stack. */
  onSelectFacet: (node: FacetNode) => void;
}

/** Theme-aware grey for the project lens's "not applied here" state. */
const LENS_GREY = 'var(--muted-foreground)';

const AREA_R = 330;
const CLUSTER_R1 = 96;
const CLUSTER_R2 = 148;

export interface NexusLayout {
  areaPos: Map<string, { x: number; y: number; angle: number }>;
  /** Keyed by the cluster node's topic (`area/cluster`). */
  clusterPos: Map<string, { x: number; y: number; area: string }>;
}

/** Lay `count` children along a BRANCH: marching outward from `origin` in the
 *  `dir` direction, in shells of growing capacity, inside a constant-width
 *  lateral band. Children follow their branch's direction instead of
 *  scattering radially — which is what keeps one area's nodes out of its
 *  neighbours' sectors at every depth (the band does not widen with radius;
 *  the cone angle narrows instead). */
function branchLayout(
  origin: { x: number; y: number },
  dir: number,
  count: number,
  opts: { firstShell: number; shellGap: number; band: number; perShell: number },
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let placed = 0;
  let shellIdx = 0;
  while (placed < count) {
    const inShell = Math.min(opts.perShell, count - placed);
    const r = opts.firstShell + shellIdx * opts.shellGap;
    // Constant lateral band: the angular spread SHRINKS as shells go deeper.
    const halfAngle = Math.atan2(opts.band, r);
    for (let i = 0; i < inShell; i += 1) {
      const t = inShell > 1 ? i / (inShell - 1) - 0.5 : 0;
      // Interleave odd shells half a slot so stacked shells don't align.
      const stagger = shellIdx % 2 === 1 && inShell > 1 ? 0.5 / (inShell - 1) : 0;
      const a = dir + (t + stagger) * 2 * halfAngle;
      out.push({ x: origin.x + Math.cos(a) * r, y: origin.y + Math.sin(a) * r });
    }
    placed += inShell;
    shellIdx += 1;
  }
  return out;
}

/** Pure geometry — the single source of node positions. */
export function computeNexusLayout(graph: TopicGraph): NexusLayout {
  const n = Math.max(graph.areas.length, 1);
  const areaPos = new Map<string, { x: number; y: number; angle: number }>();
  const clusterPos = new Map<string, { x: number; y: number; area: string }>();
  graph.areas.forEach((area, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const ax = Math.cos(angle) * AREA_R;
    const ay = Math.sin(angle) * AREA_R;
    areaPos.set(area.area, { x: ax, y: ay, angle });
    // Clusters continue the spoke OUTWARD from the keystone, in a band
    // narrower than the area's sector at the first shell (sector at R330 for
    // 15 areas ≈ ±69px of arc; the ±40px band leaves clear water between
    // neighbouring branches at every shell).
    const spots = branchLayout({ x: ax, y: ay }, angle, area.clusters.length, {
      firstShell: CLUSTER_R1,
      shellGap: CLUSTER_R2 - CLUSTER_R1,
      band: 40,
      perShell: 3,
    });
    area.clusters.forEach((cl, j) => {
      const p = spots[j] ?? { x: ax, y: ay };
      clusterPos.set(cl.topic, { x: p.x, y: p.y, area: area.area });
    });
  });
  return { areaPos, clusterPos };
}

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
  clusterLinks,
  focusCluster,
  onHoverArea,
  onFocusArea,
  onFocusCluster,
  onSelectCluster,
  onSelectFacet,
}: GraphVariantProps) {
  const layout = useMemo(() => computeNexusLayout(graph), [graph]);
  // Free-zoom reveal: leaning past ~105% starts unfolding every area's
  // clusters even without a click — the "scroll" half of the drill-down.
  const zoomVis = lod(k, 1.05, 1.5);
  const countLod = lod(k, 1.35, 1.9);

  // Pattern-connection links, focused dimension only. A link whose far
  // endpoint lives in another (hidden) branch is drawn to that area's
  // KEYSTONE — "this family connects outward, over there" — instead of to an
  // invisible node.
  const focusLinks = useMemo(() => {
    if (!focusArea) return [];
    return clusterLinks
      .map((l) => {
        const pa = layout.clusterPos.get(l.a);
        const pb = layout.clusterPos.get(l.b);
        if (!pa || !pb) return null;
        if (pa.area !== focusArea && pb.area !== focusArea) return null;
        const local = pa.area === focusArea ? pa : pb;
        const other = pa.area === focusArea ? pb : pa;
        const far = other.area !== focusArea;
        const end = far ? layout.areaPos.get(other.area) : other;
        if (!end) return null;
        return { x1: local.x, y1: local.y, x2: end.x, y2: end.y, far, count: l.count, area: local.area };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [clusterLinks, focusArea, layout]);

  return (
    <g>
      {/* Links UNDER everything — geometry first, then the nodes own hover. */}
      {focusLinks.map((l, i) => {
        const theme = areaGraphTheme(l.area);
        // Quadratic bow perpendicular to the chord: a relation, not a spoke.
        const mx = (l.x1 + l.x2) / 2 - (l.y2 - l.y1) * 0.18;
        const my = (l.y1 + l.y2) / 2 + (l.x2 - l.x1) * 0.18;
        return (
          <path
            key={i}
            d={`M ${l.x1} ${l.y1} Q ${mx} ${my} ${l.x2} ${l.y2}`}
            fill="none"
            stroke={theme.hex}
            strokeOpacity={l.far ? 0.25 : 0.4}
            strokeWidth={1 + Math.min(l.count, 4) * 0.5}
            strokeDasharray={l.far ? '5 4' : undefined}
            pointerEvents="none"
            className="animate-fade-in"
          />
        );
      })}

      {graph.areas.map((area) => {
        const pos = layout.areaPos.get(area.area);
        if (!pos) return null;
        const { x: ax, y: ay, angle } = pos;
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

            {/* Clusters unfold on focus (or free zoom), staggered so the
                dimension opens like a hand. */}
            {vis > 0.01 &&
              area.clusters.map((cl, j) => {
                const cp = layout.clusterPos.get(cl.topic);
                if (!cp) return null;
                const cR = nodeRadius(cl.count, 7, 2.6, 22);
                const isSel = selectedTopic === cl.topic;
                const clApplied = !lensOn || appliedTopics.has(cl.topic);
                const clHex = clApplied ? theme.hex : LENS_GREY;
                const clDeep = clApplied ? theme.deep : LENS_GREY;
                const clFocused = focusCluster === cl.topic;
                // Under a second-level drill, sibling clusters recede.
                const clMute =
                  (clApplied ? 1 : 0.45) * (focusCluster && !clFocused ? 0.3 : 1);
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
                      <line x1={ax} y1={ay} x2={cp.x} y2={cp.y} stroke={clHex} strokeOpacity={0.22} strokeWidth={1} />
                      <g
                        transform={`translate(${cp.x},${cp.y})`}
                        className="cursor-pointer"
                        onPointerEnter={() => onHoverArea(area.area)}
                        onPointerLeave={() => onHoverArea(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (cl.facets.length > 0) {
                            // A cluster with third-level topics drills once
                            // more: centre it and unfold the topic ring.
                            onFocusCluster(cl, { x: cp.x, y: cp.y, k: 2.3 });
                          } else {
                            // True leaf — open the pattern stack.
                            onSelectCluster(cl);
                          }
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
                        {/* Facet badge: a cluster that drills deeper says so. */}
                        {cl.facets.length > 0 && !clFocused && (
                          <text
                            y={4}
                            textAnchor="middle"
                            fill={clHex}
                            fontSize={10}
                            fontWeight={600}
                            pointerEvents="none"
                            className="select-none tabular-nums"
                          >
                            {cl.facets.length}
                          </text>
                        )}
                        {/* Third level — the cluster's topics, unfolded on
                            drill. They CONTINUE THE BRANCH: laid outward along
                            the keystone→cluster direction in the same banded
                            cone as the clusters themselves, never radially
                            around the parent (a full ring collides with the
                            sibling clusters beside it). */}
                        {clFocused &&
                          (() => {
                            const outDir = Math.atan2(cp.y - ay, cp.x - ax);
                            const spots = branchLayout({ x: 0, y: 0 }, outDir, cl.facets.length, {
                              firstShell: 54,
                              shellGap: 42,
                              band: 30,
                              perShell: 3,
                            });
                            return cl.facets.map((f, fi) => {
                              const p = spots[fi] ?? { x: 0, y: 0 };
                              const fx = p.x;
                              const fy = p.y;
                              const fR = nodeRadius(f.count, 5, 2.2, 13);
                            return (
                              <g
                                key={f.topic}
                                style={{
                                  opacity: 1,
                                  transition: 'opacity 200ms ease',
                                  transitionDelay: `${Math.min(fi * 24, 260)}ms`,
                                }}
                              >
                                <line x1={0} y1={0} x2={fx} y2={fy} stroke={clHex} strokeOpacity={0.3} strokeWidth={0.8} />
                                <g
                                  transform={`translate(${fx},${fy})`}
                                  className="cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectFacet(f);
                                  }}
                                >
                                  {f.pending > 0 && (
                                    <circle r={fR + 2} fill="none" stroke={clHex} strokeOpacity={0.4} strokeWidth={0.8} strokeDasharray="2 2" />
                                  )}
                                  <circle r={fR} fill={clDeep} fillOpacity={0.35} stroke={clHex} strokeWidth={1} />
                                  <NodeLabel k={k} dy={fR + 11} text={f.facet} sub={`${f.count}`} fill={clHex} size={9} />
                                </g>
                              </g>
                            );
                            });
                          })()}
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

/** Progress ring on a node's border — the completion-traceability readout.
 *  A faint full track plus an arc from 12 o'clock, sized just outside the
 *  node body. */
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

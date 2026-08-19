// The hierarchy sky — the old Nexus geometry (central crest, compass keystones,
// branch shells, LOD reveal, staggered unfold, sibling muting) re-parameterized
// for the knowledge hierarchy: 8 category keystones → subjects along spokes →
// techniques unfolding as the third ring on subject focus. Status is the node
// RING language: dashed draft · solid forged · double reconciled · filled
// transplant-tested. Rendered inside the host's `<g transform>`.
import { Fragment, useMemo } from 'react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';
import { adherenceRatio } from '../scorecardModel';
import { NodeLabel } from '../../canvas/GraphChrome';
import { lod } from '../../canvas/useGraphCanvas';
import { categoryGraphTheme, type CategoryGraphTheme } from './categoryTheme';
import { CoverageRing, StatusRing, statusFillOpacity } from './nodeRings';
import {
  branchLayout,
  keystoneRadius,
  techniqueKey,
  type HierarchyLayout,
  type HierarchyRenderModel,
  type SubjectNode,
  type TechniqueEntry,
} from './hierarchyGraphModel';

export interface FlyTarget {
  x: number;
  y: number;
  k: number;
}

/** Active Laws lens: everything OUTSIDE these sets dims. */
export interface LawLensSets {
  subjects: ReadonlySet<string>;
  techniques: ReadonlySet<string>;
}

export interface HierarchyNexusProps {
  model: HierarchyRenderModel;
  layout: HierarchyLayout;
  k: number;
  crestTitle: string;
  crestSub: string;
  hoverRing: string | null;
  focusRing: string | null;
  focusSubject: string | null;
  /** `ownerSubject/techniqueSlug` to pulse after a search jump. */
  highlightTechnique: string | null;
  lawLens: LawLensSets | null;
  /** Census adherence by subject slug, or `null` when the repo carries no
   *  scorecard. A subject ABSENT from the map gets NO ring — absence means "no
   *  census rules yet", never cleanliness. Subject grain only: the scorecard
   *  does not measure techniques, so technique nodes never fake a ring. */
  adherence: ReadonlyMap<string, SubjectScore> | null;
  /** Active Context lens: subject slug → sites inside the chosen context.
   *  Subjects absent from the map dim; present ones carry a site badge.
   *  Composes with the Laws lens by INTERSECTION (both mutes multiply). */
  contextSites: ReadonlyMap<string, number> | null;
  onHoverRing: (ring: string | null) => void;
  onFocusRing: (ring: string, target: FlyTarget) => void;
  onFocusSubject: (node: SubjectNode, target: FlyTarget) => void;
  onSelectTechnique: (node: SubjectNode, entry: TechniqueEntry) => void;
}

const TECHNIQUE_R = 6.5;

export default function HierarchyNexus({
  model,
  layout,
  k,
  crestTitle,
  crestSub,
  hoverRing,
  focusRing,
  focusSubject,
  highlightTechnique,
  lawLens,
  adherence,
  contextSites,
  onHoverRing,
  onFocusRing,
  onFocusSubject,
  onSelectTechnique,
}: HierarchyNexusProps) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const reducedMotion = useReducedMotion();
  // Free-zoom reveal: leaning past ~105% starts unfolding every ring's
  // subjects even without a click — the "scroll" half of the drill-down.
  const zoomVis = lod(k, 1.05, 1.5);
  const countLod = lod(k, 1.35, 1.9);

  // Subject-pair edges, focused ring only, cross-ring only (in-spoke links are
  // proximity already; cross-branch curves at overview zoom are the hairball
  // that kills every knowledge graph). An edge whose far endpoint lives in
  // another (hidden) branch is drawn dashed to that ring's KEYSTONE — "this
  // subject connects outward, over there" — instead of to an invisible node.
  const focusEdges = useMemo(() => {
    if (!focusRing) return [];
    return model.edges
      .map((e) => {
        const ringA = model.ringOfSubject.get(e.a);
        const ringB = model.ringOfSubject.get(e.b);
        if (!ringA || !ringB || ringA === ringB) return null;
        if (ringA !== focusRing && ringB !== focusRing) return null;
        const localSlug = ringA === focusRing ? e.a : e.b;
        const otherSlug = ringA === focusRing ? e.b : e.a;
        const otherRing = ringA === focusRing ? ringB : ringA;
        const pa = layout.subjectPos.get(localSlug);
        if (!pa) return null;
        const far = otherRing !== focusRing;
        const end = far ? layout.keystonePos.get(otherRing) : layout.subjectPos.get(otherSlug);
        if (!end) return null;
        return { x1: pa.x, y1: pa.y, x2: end.x, y2: end.y, far, count: e.count, ring: focusRing };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [model, layout, focusRing]);

  const lensSubjectMute = (slug: string): number =>
    lawLens ? (lawLens.subjects.has(slug) ? 1 : 0.15) : 1;
  // Context lens mute. Multiplied with the Laws lens mute, so both active at
  // once INTERSECT: only subjects citing the law AND dirty in the context stay lit.
  const contextMute = (slug: string): number =>
    contextSites ? (contextSites.has(slug) ? 1 : 0.15) : 1;

  return (
    <g>
      {/* Edges UNDER everything — geometry first, then the nodes own hover. */}
      {focusEdges.map((e, i) => {
        const theme = categoryGraphTheme(e.ring);
        // Quadratic bow perpendicular to the chord: a relation, not a spoke.
        const mx = (e.x1 + e.x2) / 2 - (e.y2 - e.y1) * 0.18;
        const my = (e.y1 + e.y2) / 2 + (e.x2 - e.x1) * 0.18;
        return (
          <path
            key={i}
            d={`M ${e.x1} ${e.y1} Q ${mx} ${my} ${e.x2} ${e.y2}`}
            fill="none"
            stroke={theme.hue}
            strokeOpacity={e.far ? 0.25 : 0.4}
            strokeWidth={1 + Math.min(e.count, 4) * 0.5}
            strokeDasharray={e.far ? '5 4' : undefined}
            pointerEvents="none"
            className="animate-fade-in"
          />
        );
      })}

      {model.rings.map((ring) => {
        const pos = layout.keystonePos.get(ring.key);
        if (!pos) return null;
        const { x: kx, y: ky, angle } = pos;
        const theme: CategoryGraphTheme = categoryGraphTheme(ring.id);
        const empty = ring.subjects.length === 0;
        const focused = focusRing === ring.key;
        const dim = focusRing ? !focused : hoverRing !== null && hoverRing !== ring.key;
        const vis = focused ? 1 : focusRing ? 0 : zoomVis;
        const kR = keystoneRadius(ring.subjects.length);
        const Icon = theme.icon;
        // Lenses: a keystone keeps colour if ANY of its subjects cites the law
        // (Laws lens) / carries sites in the chosen context (Context lens).
        const ringCited =
          !lawLens || ring.subjects.some((n) => lawLens.subjects.has(n.subject.slug));
        const ringInContext =
          !contextSites || ring.subjects.some((n) => contextSites.has(n.subject.slug));
        const ringMute = (ringCited ? 1 : 0.25) * (ringInContext ? 1 : 0.25);
        const title = ring.id === null ? p.category_unassigned : ring.title;

        return (
          <g key={ring.key} opacity={dim ? 0.22 : 1} className="transition-opacity duration-300">
            {/* Spoke: crest → keystone. Empty categories keep a faint spoke —
                the compass never reshuffles (the old AREA_ORDER contract). */}
            <line
              x1={Math.cos(angle) * 56}
              y1={Math.sin(angle) * 56}
              x2={kx - Math.cos(angle) * kR}
              y2={ky - Math.sin(angle) * kR}
              stroke={theme.hue}
              strokeOpacity={(empty ? 0.12 : 0.3) * ringMute}
              strokeWidth={empty ? 1 : 1.5 + Math.min(ring.subjects.length / 6, 2.5)}
            />

            {/* Subjects unfold on focus (or free zoom), staggered so the spoke
                opens like a hand — instantly under prefers-reduced-motion. */}
            {vis > 0.01 &&
              ring.subjects.map((node, j) => {
                const sp = layout.subjectPos.get(node.subject.slug);
                if (!sp) return null;
                const isFocused = focusSubject === node.subject.slug;
                // Under a subject drill, sibling subjects recede.
                const subjectMute =
                  lensSubjectMute(node.subject.slug) *
                  contextMute(node.subject.slug) *
                  (focusSubject && !isFocused ? 0.3 : 1);
                const score = adherence?.get(node.subject.slug) ?? null;
                const ctxSiteCount = contextSites?.get(node.subject.slug) ?? null;
                const fillOpacity = statusFillOpacity(node.subject.status);
                return (
                  <Fragment key={node.subject.slug}>
                    <g
                      style={{
                        opacity: vis * subjectMute,
                        transition: reducedMotion ? 'none' : 'opacity 240ms ease',
                        transitionDelay:
                          focused && !reducedMotion ? `${Math.min(j * 22, 330)}ms` : '0ms',
                        pointerEvents: vis < 0.4 ? 'none' : 'auto',
                      }}
                    >
                      <line
                        x1={kx}
                        y1={ky}
                        x2={sp.x}
                        y2={sp.y}
                        stroke={theme.hue}
                        strokeOpacity={0.22}
                        strokeWidth={1}
                      />
                      <g
                        transform={`translate(${sp.x},${sp.y})`}
                        className="cursor-pointer"
                        onPointerEnter={() => onHoverRing(ring.key)}
                        onPointerLeave={() => onHoverRing(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onFocusSubject(node, { x: sp.x, y: sp.y, k: 2.3 });
                        }}
                      >
                        <circle
                          r={node.r}
                          fill={theme.deep}
                          fillOpacity={fillOpacity}
                          stroke="none"
                        />
                        <StatusRing r={node.r} status={node.subject.status} stroke={theme.stroke} />
                        {/* Adherence ring — ONLY for subjects the scorecard
                            measures. No score → no ring: absence means "no
                            census rules yet", never a full green arc. */}
                        {score && (
                          <g>
                            <title>
                              {tx(p.adherence_predicate, {
                                clean: score.cleanContexts,
                                applicable: score.applicableContexts,
                                sites: score.sites,
                              })}
                            </title>
                            <CoverageRing
                              r={node.r + 5.5}
                              pct={adherenceRatio(score)}
                              stroke={theme.stroke}
                            />
                          </g>
                        )}
                        {/* Context lens site badge: how many sites THIS subject
                            carries inside the chosen context. */}
                        {ctxSiteCount !== null && (
                          <text
                            x={node.r + 7}
                            y={-node.r - 5}
                            textAnchor="start"
                            fill={theme.stroke}
                            fontSize={9}
                            fontWeight={600}
                            pointerEvents="none"
                            className="select-none tabular-nums"
                          >
                            {ctxSiteCount}
                          </text>
                        )}
                        {/* Technique badge: a subject that drills deeper says so. */}
                        {node.techniques.length > 0 && !isFocused && (
                          <text
                            y={4}
                            textAnchor="middle"
                            fill={theme.stroke}
                            fontSize={10}
                            fontWeight={600}
                            pointerEvents="none"
                            className="select-none tabular-nums"
                          >
                            {node.techniques.length}
                          </text>
                        )}
                        {/* Third ring — the subject's techniques, unfolded on
                            drill. They CONTINUE THE BRANCH: laid outward along
                            the keystone→subject direction in the same banded
                            cone, never radially around the parent (a full ring
                            collides with the sibling subjects beside it). */}
                        {isFocused &&
                          (() => {
                            const outDir = Math.atan2(sp.y - ky, sp.x - kx);
                            const spots = branchLayout({ x: 0, y: 0 }, outDir, node.techniques.length, {
                              firstShell: 52,
                              shellGap: 40,
                              band: 30,
                              perShell: 3,
                            });
                            return node.techniques.map((entry, ti) => {
                              const tp = spots[ti] ?? { x: 0, y: 0 };
                              const key = techniqueKey(entry.tech);
                              const cited = !lawLens || lawLens.techniques.has(key);
                              const highlighted = highlightTechnique === key;
                              const mute = cited ? 1 : 0.15;
                              return (
                                <g
                                  key={`${key}@${entry.owner ?? 'local'}`}
                                  style={{
                                    opacity: mute,
                                    transition: reducedMotion ? 'none' : 'opacity 200ms ease',
                                    transitionDelay: reducedMotion
                                      ? '0ms'
                                      : `${Math.min(ti * 24, 260)}ms`,
                                  }}
                                >
                                  <line
                                    x1={0}
                                    y1={0}
                                    x2={tp.x}
                                    y2={tp.y}
                                    stroke={theme.hue}
                                    strokeOpacity={0.3}
                                    strokeWidth={0.8}
                                    strokeDasharray={entry.owner ? '3 3' : undefined}
                                  />
                                  <g
                                    transform={`translate(${tp.x},${tp.y})`}
                                    className="cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectTechnique(node, entry);
                                    }}
                                  >
                                    {highlighted && (
                                      <circle
                                        r={TECHNIQUE_R + 5}
                                        fill="none"
                                        stroke={theme.stroke}
                                        strokeWidth={1.5}
                                        strokeOpacity={0.9}
                                      />
                                    )}
                                    <circle
                                      r={TECHNIQUE_R}
                                      fill={theme.deep}
                                      fillOpacity={statusFillOpacity(entry.tech.status)}
                                    />
                                    <StatusRing
                                      r={TECHNIQUE_R}
                                      status={entry.tech.status}
                                      stroke={theme.stroke}
                                      width={1}
                                    />
                                    {/* Shared-technique marker: borrowed, not owned. */}
                                    {entry.owner && (
                                      <text
                                        y={3.5}
                                        textAnchor="middle"
                                        fill={theme.stroke}
                                        fontSize={9}
                                        fontWeight={700}
                                        pointerEvents="none"
                                        className="select-none"
                                      >
                                        @
                                      </text>
                                    )}
                                    <NodeLabel
                                      k={k}
                                      dy={TECHNIQUE_R + 13}
                                      text={entry.tech.title}
                                      sub={entry.owner ? `@${entry.owner}` : undefined}
                                      fill={theme.stroke}
                                      size={9}
                                    />
                                  </g>
                                </g>
                              );
                            });
                          })()}
                        <NodeLabel
                          k={k}
                          dy={node.r + 14}
                          text={node.subject.title}
                          sub={countLod > 0.02 ? `${node.techniques.length}` : undefined}
                          fill={theme.stroke}
                          size={11}
                        />
                      </g>
                    </g>
                  </Fragment>
                );
              })}

            {/* Category keystone — the drill-down door. */}
            <g
              transform={`translate(${kx},${ky})`}
              className="cursor-pointer"
              onPointerEnter={() => onHoverRing(ring.key)}
              onPointerLeave={() => onHoverRing(null)}
              onClick={(e) => {
                e.stopPropagation();
                // Centre the clicked keystone; k=1.5 is where the subject fan
                // (next level) is fully readable. Host toggles back out if
                // already focused.
                onFocusRing(ring.key, { x: kx, y: ky, k: 1.5 });
              }}
            >
              <circle r={kR + 6} fill={theme.deep} fillOpacity={(empty ? 0.03 : 0.08) * ringMute} />
              <circle
                r={kR}
                fill={theme.deep}
                fillOpacity={(empty ? 0.06 : focused ? 0.32 : 0.2) * ringMute}
                stroke={theme.stroke}
                strokeOpacity={(empty ? 0.3 : 0.9) * ringMute}
                strokeWidth={focused ? 2.5 : 1.75}
              />
              <Icon
                x={-9}
                y={-9}
                width={18}
                height={18}
                color={theme.stroke}
                opacity={(empty ? 0.4 : 0.95) * ringMute}
                pointerEvents="none"
              />
              <NodeLabel
                k={k}
                dy={kR + 18}
                text={title}
                sub={empty ? undefined : `${ring.subjects.length}`}
                fill={theme.stroke}
                opacity={(empty ? 0.45 : 1) * ringMute}
                size={13}
                weight={600}
                pinned
              />
            </g>
          </g>
        );
      })}

      {/* Central crest. The title rides the same pinned counter-scale as the
          keystone labels so it reads at every zoom; the rings stay geometric. */}
      <g pointerEvents="none">
        <circle r={52} fill="var(--secondary)" fillOpacity={0.75} stroke="var(--border)" strokeWidth={1.5} />
        <circle r={44} fill="none" stroke="var(--primary)" strokeOpacity={0.35} strokeWidth={1} />
        <g transform={`scale(${Math.min(2.6, Math.max(0.8, 1 / k))})`}>
          <text textAnchor="middle" y={-2} fill="var(--foreground)" fontSize={13} fontWeight={600} className="select-none">
            {crestTitle.length > 14 ? `${crestTitle.slice(0, 13)}…` : crestTitle}
          </text>
          <text textAnchor="middle" y={16} fill="var(--foreground)" opacity={0.55} fontSize={11} className="select-none tabular-nums">
            {crestSub}
          </text>
        </g>
      </g>
    </g>
  );
}

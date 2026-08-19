// The Sector Atlas sky — structured radial rendering over `computeAtlasLayout`.
// Every category owns a visible angular sector (faint wedge + hairline
// boundaries: the reader SEES the containers), subjects sit on concentric arc
// bands inside it, and a subject drill hides every other subject (clear
// water) while the focused subject's techniques fan radially around it.
// Status/adherence share the Nexus's visual language via `nodeRings`.
import { useMemo, useState } from 'react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';
import { adherenceRatio } from '../scorecardModel';
import { NodeLabel } from '../../canvas/GraphChrome';
import {
  atlasTechniqueFan,
  ATLAS_WEDGE_INNER_R,
  type AtlasLayout,
} from './atlasLayout';
import { categoryGraphTheme, type CategoryGraphTheme } from './categoryTheme';
import type { FlyTarget, LawLensSets } from './HierarchyNexus';
import { CoverageRing, StatusRing, statusFillOpacity } from './nodeRings';
import {
  keystoneRadius,
  techniqueKey,
  type HierarchyRenderModel,
  type SubjectNode,
  type TechniqueEntry,
} from './hierarchyGraphModel';

export interface HierarchyAtlasProps {
  model: HierarchyRenderModel;
  layout: AtlasLayout;
  k: number;
  crestTitle: string;
  crestSub: string;
  hoverRing: string | null;
  focusRing: string | null;
  focusSubject: string | null;
  highlightTechnique: string | null;
  lawLens: LawLensSets | null;
  adherence: ReadonlyMap<string, SubjectScore> | null;
  contextSites: ReadonlyMap<string, number> | null;
  onHoverRing: (ring: string | null) => void;
  onFocusRing: (ring: string, target: FlyTarget) => void;
  onFocusSubject: (node: SubjectNode, target: FlyTarget) => void;
  onSelectTechnique: (node: SubjectNode, entry: TechniqueEntry) => void;
}

const TECHNIQUE_R = 6.5;

/** Annular sector path from `innerR` to `outerR` across [start, end]. */
function wedgePath(innerR: number, outerR: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const pt = (r: number, a: number) => `${r * Math.cos(a)} ${r * Math.sin(a)}`;
  return [
    `M ${pt(innerR, start)}`,
    `L ${pt(outerR, start)}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${pt(outerR, end)}`,
    `L ${pt(innerR, end)}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${pt(innerR, start)}`,
    'Z',
  ].join(' ');
}

export default function HierarchyAtlas({
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
}: HierarchyAtlasProps) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const reducedMotion = useReducedMotion();
  const [hoverSubject, setHoverSubject] = useState<string | null>(null);

  // Cross-subject edges ONLY for the focused (or hovered) subject — never an
  // all-pairs hairball. Under a drill every other subject is hidden, so the
  // far end is drawn dashed ("connects outward, over there").
  const activeSubject = focusSubject ?? hoverSubject;
  const subjectEdges = useMemo(() => {
    if (!activeSubject) return [];
    const pa = layout.subjectPos.get(activeSubject);
    if (!pa) return [];
    return model.edges
      .map((e) => {
        if (e.a !== activeSubject && e.b !== activeSubject) return null;
        const other = e.a === activeSubject ? e.b : e.a;
        const pb = layout.subjectPos.get(other);
        if (!pb) return null;
        const ring = model.ringOfSubject.get(activeSubject) ?? null;
        return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, count: e.count, ring };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [model, layout, activeSubject]);

  const lensSubjectMute = (slug: string): number =>
    lawLens ? (lawLens.subjects.has(slug) ? 1 : 0.15) : 1;
  const contextMute = (slug: string): number =>
    contextSites ? (contextSites.has(slug) ? 1 : 0.15) : 1;

  return (
    <g>
      {/* Sector structure UNDER everything — the enforced order made visible. */}
      {model.rings.map((ring) => {
        const sector = layout.sectors.get(ring.key);
        if (!sector) return null;
        const theme = categoryGraphTheme(ring.id);
        const hovered = hoverRing === ring.key;
        return (
          <g key={`w:${ring.key}`} pointerEvents="none">
            <path
              d={wedgePath(ATLAS_WEDGE_INNER_R, sector.outerR, sector.start, sector.end)}
              fill={theme.deep}
              fillOpacity={hovered ? 0.07 : 0.04}
              className="transition-opacity duration-300"
            />
            {[sector.start, sector.end].map((a, bi) => (
              <line
                key={bi}
                x1={Math.cos(a) * ATLAS_WEDGE_INNER_R}
                y1={Math.sin(a) * ATLAS_WEDGE_INNER_R}
                x2={Math.cos(a) * sector.outerR}
                y2={Math.sin(a) * sector.outerR}
                stroke={theme.hue}
                strokeOpacity={0.16}
                strokeWidth={0.75}
              />
            ))}
          </g>
        );
      })}

      {/* Focused/hovered subject's cross-subject relations. */}
      {subjectEdges.map((e, i) => {
        const theme = categoryGraphTheme(e.ring);
        const mx = (e.x1 + e.x2) / 2 - (e.y2 - e.y1) * 0.18;
        const my = (e.y1 + e.y2) / 2 + (e.x2 - e.x1) * 0.18;
        return (
          <path
            key={i}
            d={`M ${e.x1} ${e.y1} Q ${mx} ${my} ${e.x2} ${e.y2}`}
            fill="none"
            stroke={theme.hue}
            strokeOpacity={focusSubject ? 0.3 : 0.4}
            strokeWidth={1 + Math.min(e.count, 4) * 0.5}
            strokeDasharray={focusSubject ? '5 4' : undefined}
            pointerEvents="none"
            className="animate-fade-in"
          />
        );
      })}

      {model.rings.map((ring) => {
        const pos = layout.keystonePos.get(ring.key);
        if (!pos) return null;
        const sector = layout.sectors.get(ring.key);
        const theme: CategoryGraphTheme = categoryGraphTheme(ring.id);
        const empty = ring.subjects.length === 0;
        const focused = focusRing === ring.key;
        const kR = keystoneRadius(ring.subjects.length);
        const Icon = theme.icon;
        const ringCited =
          !lawLens || ring.subjects.some((n) => lawLens.subjects.has(n.subject.slug));
        const ringInContext =
          !contextSites || ring.subjects.some((n) => contextSites.has(n.subject.slug));
        const ringMute = (ringCited ? 1 : 0.25) * (ringInContext ? 1 : 0.25);
        const title = ring.id === null ? p.category_unassigned : ring.title;
        // Fly to the sector's radial centroid, wide enough to read the bands.
        const centroidR = sector ? (ATLAS_WEDGE_INNER_R + sector.outerR) / 2 : 260;
        const target: FlyTarget = {
          x: Math.cos(pos.angle) * centroidR,
          y: Math.sin(pos.angle) * centroidR,
          k: 1.3,
        };

        return (
          <g key={ring.key}>
            {/* Subjects on their arc bands — always visible (structure IS the
                readability), hidden to near-zero under a foreign drill. */}
            {ring.subjects.map((node) => {
              const sp = layout.subjectPos.get(node.subject.slug);
              if (!sp) return null;
              const isFocused = focusSubject === node.subject.slug;
              // Drill = clear water: every OTHER subject hides, not mutes.
              const drillMute = focusSubject && !isFocused ? 0.06 : 1;
              const subjectMute =
                lensSubjectMute(node.subject.slug) * contextMute(node.subject.slug) * drillMute;
              const score = adherence?.get(node.subject.slug) ?? null;
              const ctxSiteCount = contextSites?.get(node.subject.slug) ?? null;
              const fillOpacity = statusFillOpacity(node.subject.status);
              return (
                <g
                  key={node.subject.slug}
                  style={{
                    opacity: subjectMute,
                    transition: reducedMotion ? 'none' : 'opacity 240ms ease',
                    pointerEvents: drillMute < 0.4 ? 'none' : 'auto',
                  }}
                >
                  <g
                    transform={`translate(${sp.x},${sp.y})`}
                    className="cursor-pointer"
                    onPointerEnter={() => {
                      onHoverRing(ring.key);
                      setHoverSubject(node.subject.slug);
                    }}
                    onPointerLeave={() => {
                      onHoverRing(null);
                      setHoverSubject(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFocusSubject(node, { x: sp.x, y: sp.y, k: 2.2 });
                    }}
                  >
                    <circle r={node.r} fill={theme.deep} fillOpacity={fillOpacity} stroke="none" />
                    <StatusRing r={node.r} status={node.subject.status} stroke={theme.stroke} />
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
                    {/* Technique fan — RADIAL rings around the focused subject.
                        Full 360° is safe here because siblings are hidden. */}
                    {isFocused &&
                      (() => {
                        const spots = atlasTechniqueFan(node.techniques.length);
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
                      sub={`${node.techniques.length}`}
                      fill={theme.stroke}
                      size={11}
                    />
                  </g>
                </g>
              );
            })}

            {/* Category keystone at the sector's inner radius, on mid-angle. */}
            <g
              transform={`translate(${pos.x},${pos.y})`}
              className="cursor-pointer"
              style={{
                opacity: focusSubject ? 0.25 : 1,
                transition: reducedMotion ? 'none' : 'opacity 240ms ease',
              }}
              onPointerEnter={() => onHoverRing(ring.key)}
              onPointerLeave={() => onHoverRing(null)}
              onClick={(e) => {
                e.stopPropagation();
                onFocusRing(ring.key, target);
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

      {/* Central crest — same idiom as the Nexus. */}
      <g pointerEvents="none" opacity={focusSubject ? 0.25 : 1}>
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

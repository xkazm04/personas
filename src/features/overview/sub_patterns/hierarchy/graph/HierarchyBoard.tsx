// The Column Board sky — orthogonal rendering over `computeBoardLayout`. One
// column per category, fixed-height pills with the label INSIDE (an SVG
// <title> carries the full text), so neither node nor label collision can
// exist. Status translates the ring language into a pill BORDER language:
// dashed draft · solid forged · double reconciled · thick+filled
// transplant-tested. Adherence is a slim progress bar along the pill's bottom
// edge. Focusing a subject expands it accordion-style — the layout inserts the
// technique sub-pills and reflows the column (the host recomputes on focus).
import { Fragment, useMemo, useState } from 'react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';
import { adherenceRatio } from '../scorecardModel';
import { NodeLabel } from '../../canvas/GraphChrome';
import { BOARD_COL_W, type BoardLayout, type BoardRect } from './boardLayout';
import { categoryGraphTheme, type CategoryGraphTheme } from './categoryTheme';
import type { FlyTarget, LawLensSets } from './HierarchyNexus';
import {
  techniqueKey,
  type HierarchyRenderModel,
  type SubjectNode,
  type TechniqueEntry,
} from './hierarchyGraphModel';
import { statusFillOpacity } from './nodeRings';

export interface HierarchyBoardProps {
  model: HierarchyRenderModel;
  layout: BoardLayout;
  k: number;
  focusRing: string | null;
  focusSubject: string | null;
  highlightTechnique: string | null;
  lawLens: LawLensSets | null;
  adherence: ReadonlyMap<string, SubjectScore> | null;
  contextSites: ReadonlyMap<string, number> | null;
  onFocusRing: (ring: string, target: FlyTarget) => void;
  onFocusSubject: (node: SubjectNode, target: FlyTarget) => void;
  onSelectTechnique: (node: SubjectNode, entry: TechniqueEntry) => void;
}

/** Strongest-first cap on hover/focus relation beziers. */
const MAX_EDGES = 12;
const PILL_RX = 8;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(max - 1, 1))}…` : text;
}

/** Status → pill border language (rect edition of the StatusRing). */
function PillBorder({
  rect,
  status,
  stroke,
}: {
  rect: BoardRect;
  status: string | null;
  stroke: string;
}) {
  const base = { x: 0, y: 0, width: rect.w, height: rect.h, rx: PILL_RX, fill: 'none' as const };
  switch (status) {
    case 'forged':
      return <rect {...base} stroke={stroke} strokeWidth={1.5} />;
    case 'reconciled':
      return (
        <>
          <rect {...base} stroke={stroke} strokeWidth={1.25} />
          <rect
            x={3}
            y={3}
            width={rect.w - 6}
            height={rect.h - 6}
            rx={PILL_RX - 3}
            fill="none"
            stroke={stroke}
            strokeWidth={0.9}
            strokeOpacity={0.8}
          />
        </>
      );
    case 'transplant-tested':
      return <rect {...base} stroke={stroke} strokeWidth={2.5} />;
    default:
      return (
        <rect {...base} stroke={stroke} strokeWidth={1.25} strokeOpacity={0.65} strokeDasharray="4 3" />
      );
  }
}

export default function HierarchyBoard({
  model,
  layout,
  k,
  focusRing,
  focusSubject,
  highlightTechnique,
  lawLens,
  adherence,
  contextSites,
  onFocusRing,
  onFocusSubject,
  onSelectTechnique,
}: HierarchyBoardProps) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const reducedMotion = useReducedMotion();
  const [hoverSubject, setHoverSubject] = useState<string | null>(null);

  // Relation beziers ONLY for the focused/hovered subject, strongest 12,
  // stroked by the SOURCE subject's category theme.
  const activeSubject = focusSubject ?? hoverSubject;
  const edges = useMemo(() => {
    if (!activeSubject) return [];
    const src = layout.pills.get(activeSubject);
    if (!src) return [];
    const theme = categoryGraphTheme(
      model.rings.find((r) => r.key === (model.ringOfSubject.get(activeSubject) ?? ''))?.id ?? null,
    );
    return model.edges
      .filter((e) => e.a === activeSubject || e.b === activeSubject)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_EDGES)
      .map((e) => {
        const other = e.a === activeSubject ? e.b : e.a;
        const dst = layout.pills.get(other);
        if (!dst) return null;
        const rightward = dst.x + dst.w / 2 >= src.x + src.w / 2;
        const x1 = rightward ? src.x + src.w : src.x;
        const y1 = src.y + src.h / 2;
        const x2 = rightward ? dst.x : dst.x + dst.w;
        const y2 = dst.y + dst.h / 2;
        const bow = Math.max(Math.abs(x2 - x1) * 0.35, 40) * (rightward ? 1 : -1);
        return {
          d: `M ${x1} ${y1} C ${x1 + bow} ${y1}, ${x2 - bow} ${y2}, ${x2} ${y2}`,
          count: e.count,
          hue: theme.hue,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [model, layout, activeSubject]);

  const lensSubjectMute = (slug: string): number =>
    lawLens ? (lawLens.subjects.has(slug) ? 1 : 0.15) : 1;
  const contextMute = (slug: string): number =>
    contextSites ? (contextSites.has(slug) ? 1 : 0.15) : 1;

  const techRowsByIndex = useMemo(() => {
    const map = new Map<number, BoardRect>();
    for (const row of layout.techniqueRows) map.set(row.index, row);
    return map;
  }, [layout]);

  return (
    <g>
      {/* Edges UNDER the pills. */}
      {edges.map((e, i) => (
        <path
          key={i}
          d={e.d}
          fill="none"
          stroke={e.hue}
          strokeOpacity={0.4}
          strokeWidth={1 + Math.min(e.count, 4) * 0.5}
          pointerEvents="none"
          className="animate-fade-in"
        />
      ))}

      {model.rings.map((ring) => {
        const kp = layout.keystonePos.get(ring.key);
        if (!kp) return null;
        const theme: CategoryGraphTheme = categoryGraphTheme(ring.id);
        const empty = ring.subjects.length === 0;
        const focused = focusRing === ring.key;
        const Icon = theme.icon;
        const ringCited =
          !lawLens || ring.subjects.some((n) => lawLens.subjects.has(n.subject.slug));
        const ringInContext =
          !contextSites || ring.subjects.some((n) => contextSites.has(n.subject.slug));
        const ringMute = (ringCited ? 1 : 0.25) * (ringInContext ? 1 : 0.25);
        const title = ring.id === null ? p.category_unassigned : ring.title;

        return (
          <g key={ring.key}>
            {/* Column header = keystone. Click flies to the column top. */}
            <g
              transform={`translate(${kp.x},${kp.y})`}
              className="cursor-pointer"
              opacity={ringMute * (empty ? 0.5 : 1)}
              onClick={(e) => {
                e.stopPropagation();
                onFocusRing(ring.key, { x: kp.x, y: kp.y + 190, k: 0.9 });
              }}
            >
              <rect
                x={-BOARD_COL_W / 2 + 12}
                y={-20}
                width={BOARD_COL_W - 24}
                height={40}
                rx={PILL_RX}
                fill={theme.deep}
                fillOpacity={focused ? 0.28 : 0.14}
                stroke={theme.stroke}
                strokeOpacity={focused ? 0.9 : 0.5}
                strokeWidth={focused ? 2 : 1.25}
              />
              <Icon
                x={-BOARD_COL_W / 2 + 22}
                y={-8}
                width={16}
                height={16}
                color={theme.stroke}
                pointerEvents="none"
              />
              <text
                x={-BOARD_COL_W / 2 + 46}
                y={4}
                textAnchor="start"
                fill={theme.stroke}
                fontSize={12.5}
                fontWeight={600}
                pointerEvents="none"
                className="select-none"
              >
                {truncate(title, 22)}
              </text>
              <text
                x={BOARD_COL_W / 2 - 22}
                y={4}
                textAnchor="end"
                fill={theme.stroke}
                fontSize={11}
                fontWeight={500}
                opacity={0.7}
                pointerEvents="none"
                className="select-none tabular-nums"
              >
                {ring.subjects.length}
              </text>
              <title>{title}</title>
            </g>

            {ring.subjects.map((node) => {
              const rect = layout.pills.get(node.subject.slug);
              if (!rect) return null;
              const isFocused = focusSubject === node.subject.slug;
              const subjectMute =
                lensSubjectMute(node.subject.slug) * contextMute(node.subject.slug);
              const score = adherence?.get(node.subject.slug) ?? null;
              const ctxSiteCount = contextSites?.get(node.subject.slug) ?? null;
              const fillOpacity = statusFillOpacity(node.subject.status);
              // Right-side furniture: technique-count chip, then site badge.
              const hasChip = node.techniques.length > 0;
              const labelMax = hasChip || ctxSiteCount !== null ? 24 : 30;
              return (
                <Fragment key={node.subject.slug}>
                  <g
                    transform={`translate(${rect.x},${rect.y})`}
                    className="cursor-pointer"
                    style={{
                      opacity: subjectMute,
                      transition: reducedMotion ? 'none' : 'opacity 240ms ease',
                    }}
                    onPointerEnter={() => setHoverSubject(node.subject.slug)}
                    onPointerLeave={() => setHoverSubject(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFocusSubject(node, {
                        x: rect.x + rect.w / 2,
                        y: rect.y + rect.h / 2,
                        k: 1.4,
                      });
                    }}
                  >
                    <rect
                      width={rect.w}
                      height={rect.h}
                      rx={PILL_RX}
                      fill={theme.deep}
                      fillOpacity={isFocused ? Math.min(fillOpacity + 0.12, 0.65) : fillOpacity}
                    />
                    <PillBorder rect={rect} status={node.subject.status} stroke={theme.stroke} />
                    <text
                      x={10}
                      y={rect.h / 2 + 4}
                      textAnchor="start"
                      fill={theme.stroke}
                      fontSize={11}
                      fontWeight={isFocused ? 600 : 500}
                      pointerEvents="none"
                      className="select-none"
                    >
                      {truncate(node.subject.title, labelMax)}
                    </text>
                    {ctxSiteCount !== null && (
                      <text
                        x={rect.w - 8}
                        y={rect.h / 2 + 4}
                        textAnchor="end"
                        fill={theme.stroke}
                        fontSize={9.5}
                        fontWeight={700}
                        pointerEvents="none"
                        className="select-none tabular-nums"
                      >
                        {ctxSiteCount}
                      </text>
                    )}
                    {hasChip && (
                      <text
                        x={rect.w - (ctxSiteCount !== null ? 28 : 8)}
                        y={rect.h / 2 + 4}
                        textAnchor="end"
                        fill={theme.stroke}
                        fontSize={10}
                        fontWeight={500}
                        opacity={0.65}
                        pointerEvents="none"
                        className="select-none tabular-nums"
                      >
                        {node.techniques.length}
                      </text>
                    )}
                    {/* Adherence bar along the bottom edge — ABSENT subject =
                        NO bar (absence is never cleanliness). */}
                    {score && (
                      <g pointerEvents="none">
                        <rect
                          x={PILL_RX}
                          y={rect.h - 4}
                          width={rect.w - PILL_RX * 2}
                          height={3}
                          rx={1.5}
                          fill={theme.stroke}
                          fillOpacity={0.15}
                        />
                        {adherenceRatio(score) > 0 && (
                          <rect
                            x={PILL_RX}
                            y={rect.h - 4}
                            width={(rect.w - PILL_RX * 2) * adherenceRatio(score)}
                            height={3}
                            rx={1.5}
                            fill={theme.stroke}
                            fillOpacity={0.85}
                          />
                        )}
                      </g>
                    )}
                    <title>{node.subject.title}</title>
                  </g>

                  {/* Accordion: technique sub-pills beneath the focused pill. */}
                  {isFocused &&
                    node.techniques.map((entry, ti) => {
                      const tr = techRowsByIndex.get(ti);
                      if (!tr) return null;
                      const key = techniqueKey(entry.tech);
                      const cited = !lawLens || lawLens.techniques.has(key);
                      const highlighted = highlightTechnique === key;
                      return (
                        <g
                          key={`${key}@${entry.owner ?? 'local'}`}
                          transform={`translate(${tr.x},${tr.y})`}
                          className="cursor-pointer"
                          style={{
                            opacity: cited ? 1 : 0.15,
                            transition: reducedMotion ? 'none' : 'opacity 200ms ease',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTechnique(node, entry);
                          }}
                        >
                          <rect
                            width={tr.w}
                            height={tr.h}
                            rx={PILL_RX - 2}
                            fill={theme.deep}
                            fillOpacity={statusFillOpacity(entry.tech.status)}
                          />
                          <PillBorder
                            rect={tr}
                            status={entry.tech.status}
                            stroke={
                              highlighted ? theme.hue : theme.stroke
                            }
                          />
                          {highlighted && (
                            <rect
                              x={-2.5}
                              y={-2.5}
                              width={tr.w + 5}
                              height={tr.h + 5}
                              rx={PILL_RX}
                              fill="none"
                              stroke={theme.stroke}
                              strokeWidth={1.5}
                              strokeOpacity={0.9}
                              pointerEvents="none"
                            />
                          )}
                          <text
                            x={8}
                            y={tr.h / 2 + 3.5}
                            textAnchor="start"
                            fill={theme.stroke}
                            fontSize={10}
                            fontWeight={500}
                            pointerEvents="none"
                            className="select-none"
                          >
                            {`${entry.owner ? '@ ' : ''}${truncate(entry.tech.title, entry.owner ? 24 : 27)}`}
                          </text>
                          <title>
                            {entry.owner
                              ? tx(p.shared_owner_note, { owner: entry.owner })
                              : entry.tech.title}
                          </title>
                        </g>
                      );
                    })}
                </Fragment>
              );
            })}

            {/* Empty column keeps its geography with an honest ghost slot. */}
            {empty && (
              <g transform={`translate(${kp.x},${kp.y + 46})`} pointerEvents="none">
                <NodeLabel k={k} dy={0} text="—" fill={theme.stroke} opacity={0.35} size={11} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

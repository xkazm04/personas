// User-drawn group rectangles: dashed semi-transparent primary-tinted zones
// beneath the islands, with a counter-scaled label plate. Round 5 (Figma
// pass): in EDIT mode a group is a real container — drag its body to move the
// group AND every project inside it, drag the corner handle to resize, click
// the label to rename, × to delete. Pointer logic is self-contained via
// pointer capture on the rects, so the canvas shell stays thin.
import { useRef } from 'react';
import { Rocket, X } from 'lucide-react';

import { mix, STATE_INK } from './ink';
import type { CanvasMode, GroupRect, IslandState } from './types';

const MIN_SIZE = 90;

/** One island as the group layer sees it — centre for containment, plus the
 *  few fields the group's rollup summarizes. */
export interface GroupMember {
  slug: string;
  x: number;
  y: number;
  state: IslandState;
  blockers: number;
  /** Can host a Fleet session (real project with a root path). */
  dispatchable: boolean;
}

/** Worst-first island states — a group's histogram reads worst-to-best. */
const STATE_ORDER: IslandState[] = ['critical', 'warning', 'building', 'healthy'];

/** How many members sit in each state, worst first, empty states dropped. A
 *  single worst-state dot summarizes a group of ten by its unluckiest member;
 *  the spread is what tells you whether that's a fire or an outlier. */
function stateHistogram(members: GroupMember[]): Array<{ state: IslandState; count: number }> {
  return STATE_ORDER
    .map((state) => ({ state, count: members.filter((m) => m.state === state).length }))
    .filter((b) => b.count > 0);
}

const inside = (i: { x: number; y: number }, g: GroupRect) =>
  i.x >= g.x && i.x <= g.x + g.w && i.y >= g.y && i.y <= g.y + g.h;

type BodyDrag = {
  id: number; sx: number; sy: number; z: number; g0: GroupRect;
  contained: Array<{ slug: string; x0: number; y0: number; el: SVGGElement | null }>;
  resizing: boolean;
};

export function GroupLayer({ groups, draft, z, mode, islands, onGroupsChange, onIslandCommit, onRename, onDelete, onDispatchGroup }: {
  groups: GroupRect[];
  /** Live drag rectangle while drawing, world coords (normalized). */
  draft: { x: number; y: number; w: number; h: number } | null;
  z: number;
  mode: CanvasMode;
  /** Island centres + rollup inputs — a group carries the islands inside it
   *  when moved, and summarizes them on its label plate. */
  islands: GroupMember[];
  onGroupsChange: (next: GroupRect[], persist: boolean) => void;
  onIslandCommit: (slug: string, x: number, y: number) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  /** Rocket on the label plate — dispatch one instruction to every dispatchable
   *  project inside the group. */
  onDispatchGroup: (groupId: string, slugs: string[]) => void;
}) {
  const k = 1 / z;
  const drag = useRef<BodyDrag | null>(null);
  const editable = mode === 'edit';
  const labelable = mode === 'edit' || mode === 'group';

  const begin = (e: React.PointerEvent<SVGElement>, g: GroupRect, resizing: boolean) => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY, z, g0: g, resizing,
      // Member islands move imperatively during the drag (their <g> transform
      // is written directly — no per-move React state), then commit on release.
      contained: resizing ? [] : islands
        .filter((i) => inside(i, g))
        .map((i) => ({
          slug: i.slug, x0: i.x, y0: i.y,
          el: (e.currentTarget as SVGElement).ownerSVGElement?.querySelector<SVGGElement>(`[data-mm-island="${CSS.escape(i.slug)}"]`) ?? null,
        })),
    };
  };

  const apply = (e: React.PointerEvent<SVGElement>, persist: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = (e.clientX - d.sx) / d.z;
    const dy = (e.clientY - d.sy) / d.z;
    const moved: GroupRect = d.resizing
      ? { ...d.g0, w: Math.max(MIN_SIZE, d.g0.w + dx), h: Math.max(MIN_SIZE, d.g0.h + dy) }
      : { ...d.g0, x: d.g0.x + dx, y: d.g0.y + dy };
    onGroupsChange(groups.map((g) => (g.id === moved.id ? moved : g)), persist);
    for (const c of d.contained) {
      if (persist) onIslandCommit(c.slug, c.x0 + dx, c.y0 + dy);
      else c.el?.setAttribute('transform', `translate(${c.x0 + dx} ${c.y0 + dy})`);
    }
    if (persist) drag.current = null;
  };

  return (
    <g>
      {groups.map((g) => {
        // Rollup: what's inside this box, worst-first. A group is the only
        // portfolio-level grouping the canvas has, so its plate is where the
        // "how are these N projects doing" question gets answered.
        const members = islands.filter((i) => inside(i, g));
        const histogram = stateHistogram(members);
        const blockers = members.reduce((s, m) => s + m.blockers, 0);
        const dispatchable = members.filter((m) => m.dispatchable).map((m) => m.slug);
        // Plate width tracks whatever segments actually render.
        const labelW = g.label.length * 7.2;
        const BUCKET_GAP = 6;
        const bucketW = (count: number) => 17 + String(count).length * 7 + BUCKET_GAP;
        const summaryW = histogram.reduce((w, b) => w + bucketW(b.count), 0) + (histogram.length ? 4 : 0);
        const blockerW = blockers > 0 ? 12 + String(blockers).length * 7 : 0;
        const dispatchW = editable && dispatchable.length > 0 ? 24 : 0;
        const plateW = labelW + summaryW + blockerW + dispatchW + (labelable ? 44 : 18);
        let cursorX = labelW + 10;
        return (
        <g key={g.id} data-testid={`mm-group-${g.id}`}>
          <rect
            x={g.x} y={g.y} width={g.w} height={g.h} rx={12}
            fill={mix('var(--primary)', 5)}
            stroke={mix('var(--primary)', 45)}
            strokeWidth={2} strokeDasharray="10 8"
            style={editable ? { cursor: 'move' } : undefined}
            onPointerDown={(e) => begin(e, g, false)}
            onPointerMove={(e) => apply(e, false)}
            onPointerUp={(e) => apply(e, true)}
            onPointerCancel={(e) => apply(e, true)}
          />
          {/* resize handle — bottom-right, constant screen size */}
          {editable && (
            <g transform={`translate(${g.x + g.w} ${g.y + g.h}) scale(${k})`}>
              <rect
                x={-7} y={-7} width={14} height={14} rx={3}
                fill={mix('var(--background)', 80)}
                stroke={mix('var(--primary)', 60)} strokeWidth={1.5}
                style={{ cursor: 'nwse-resize' }}
                onPointerDown={(e) => begin(e, g, true)}
                onPointerMove={(e) => apply(e, false)}
                onPointerUp={(e) => apply(e, true)}
                onPointerCancel={(e) => apply(e, true)}
                data-testid={`mm-group-resize-${g.id}`}
              />
            </g>
          )}
          {/* label plate — counter-scaled at the rect's top-left corner */}
          <g transform={`translate(${g.x + 10} ${g.y}) scale(${k})`}>
            <g transform="translate(0 -8)">
              <rect
                x={-6} y={-20} width={plateW} height={26} rx={13}
                fill={mix('var(--background)', 85)}
                stroke={mix('var(--primary)', 40)} strokeWidth={1}
                style={labelable ? { cursor: 'text' } : undefined}
                onPointerDown={(e) => { if (labelable) { e.stopPropagation(); onRename(g.id); } }}
              />
              <text x={4} y={-2} fontSize={12.5} fontWeight={600} fill={mix('var(--primary)', 80, 'var(--foreground)')} letterSpacing="0.03em" pointerEvents="none">
                {g.label}
              </text>
              {/* rollup: how the members are spread across states, worst first */}
              {histogram.length > 0 && (() => {
                const x = cursorX; cursorX += summaryW;
                let bx = 0;
                return (
                  <g transform={`translate(${x} 0)`} pointerEvents="none">
                    {histogram.map((b) => {
                      const at = bx; bx += bucketW(b.count);
                      return (
                        <g key={b.state} transform={`translate(${at} 0)`}>
                          <circle cx={4} cy={-6} r={4} fill={STATE_INK[b.state]} />
                          <text x={12} y={-2} fontSize={12} fontWeight={600} fill={mix(STATE_INK[b.state], 85, 'var(--foreground)')} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {b.count}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}
              {/* total blockers across the group — only when there are any */}
              {blockers > 0 && (() => {
                const x = cursorX; cursorX += blockerW;
                return (
                  <text x={x} y={-2} fontSize={12} fontWeight={700} fill="var(--status-error)" style={{ fontVariantNumeric: 'tabular-nums' }} pointerEvents="none">
                    {blockers}
                  </text>
                );
              })()}
              {/* one instruction to every dispatchable project in the box */}
              {editable && dispatchable.length > 0 && (() => {
                const x = cursorX; cursorX += dispatchW;
                return (
                  <g
                    transform={`translate(${x + 8} -7)`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => { e.stopPropagation(); onDispatchGroup(g.id, dispatchable); }}
                    data-testid={`mm-group-dispatch-${g.id}`}
                  >
                    <circle r={8} fill={mix('var(--primary)', 12, 'var(--background)')} stroke={mix('var(--primary)', 50)} strokeWidth={1} />
                    <Rocket x={-5} y={-5} width={10} height={10} style={{ color: 'var(--primary)' }} strokeWidth={2} />
                  </g>
                );
              })()}
              {labelable && (
                <g
                  transform={`translate(${plateW - 28} -7)`}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => { e.stopPropagation(); onDelete(g.id); }}
                  data-testid={`mm-group-delete-${g.id}`}
                >
                  <circle r={8} fill={mix('var(--status-error)', 15, 'var(--background)')} stroke={mix('var(--status-error)', 50)} strokeWidth={1} />
                  <X x={-5} y={-5} width={10} height={10} style={{ color: 'var(--status-error)' }} strokeWidth={2.25} />
                </g>
              )}
            </g>
          </g>
        </g>
        );
      })}
      {draft && (
        <rect
          x={draft.x} y={draft.y} width={draft.w} height={draft.h} rx={12}
          fill={mix('var(--primary)', 7)}
          stroke={mix('var(--primary)', 60)}
          strokeWidth={2} strokeDasharray="10 8"
        />
      )}
    </g>
  );
}

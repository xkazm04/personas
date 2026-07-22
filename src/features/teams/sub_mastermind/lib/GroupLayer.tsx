// User-drawn group rectangles: dashed semi-transparent primary-tinted zones
// beneath the islands, with a counter-scaled label plate (constant screen
// size). In group mode the label is clickable (rename) and deletable.
import { X } from 'lucide-react';

import { mix } from './ink';
import type { GroupRect } from './types';

export function GroupLayer({ groups, draft, z, interactive, onRename, onDelete }: {
  groups: GroupRect[];
  /** Live drag rectangle while drawing, world coords (normalized). */
  draft: { x: number; y: number; w: number; h: number } | null;
  z: number;
  /** Group mode: labels clickable for rename, delete button shown. */
  interactive: boolean;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const k = 1 / z;
  return (
    <g>
      {groups.map((g) => (
        <g key={g.id} data-testid={`mm-group-${g.id}`}>
          <rect
            x={g.x} y={g.y} width={g.w} height={g.h} rx={12}
            fill={mix('var(--primary)', 5)}
            stroke={mix('var(--primary)', 45)}
            strokeWidth={2} strokeDasharray="10 8"
          />
          {/* label plate — counter-scaled at the rect's top-left corner */}
          <g transform={`translate(${g.x + 10} ${g.y}) scale(${k})`}>
            <g transform="translate(0 -8)">
              <rect
                x={-6} y={-20} width={g.label.length * 7.2 + (interactive ? 44 : 18)} height={26} rx={13}
                fill={mix('var(--background)', 85)}
                stroke={mix('var(--primary)', 40)} strokeWidth={1}
                style={interactive ? { cursor: 'text' } : undefined}
                onPointerDown={(e) => { if (interactive) { e.stopPropagation(); onRename(g.id); } }}
              />
              <text x={4} y={-2} fontSize={12.5} fontWeight={600} fill={mix('var(--primary)', 80, 'var(--foreground)')} letterSpacing="0.03em" pointerEvents="none">
                {g.label}
              </text>
              {interactive && (
                <g
                  transform={`translate(${g.label.length * 7.2 + 22} -7)`}
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
      ))}
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

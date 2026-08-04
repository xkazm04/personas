// User-drawn project connections (connect tool): straight styled lines with a
// counter-scaled label pill at the midpoint. Distinct from the derived
// integration Routes (dotted arcs) — these are the user's own annotations,
// with chosen colour and full/dashed style. Also renders the connect-mode
// source marker while a link is half-drawn.
import { useTranslation } from '@/i18n/useTranslation';

import { mix } from './ink';
import type { Island, UserLink } from './types';

export function LinkLayer({ links, bySlug, z, clickable, onEdit }: {
  links: readonly UserLink[];
  bySlug: Map<string, Island>;
  z: number;
  /** Edit/connect modes: label pills are clickable to reopen the editor. */
  clickable: boolean;
  onEdit: (id: string) => void;
}) {
  const { t } = useTranslation();
  const k = 1 / z;
  return (
    <g>
      {links.map((l) => {
        const a = bySlug.get(l.from);
        const b = bySlug.get(l.to);
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const plateW = Math.max(26, l.label.length * 7.4 + 16);
        const athena = l.author === 'athena';
        return (
          <g key={l.id} data-testid={`mm-link-${l.id}`}>
            {/* provenance: an accent underlay behind the stroke keeps the
                user's chosen colour intact while still reading as "not mine" */}
            {athena && (
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="var(--accent)" strokeWidth={7} strokeLinecap="round" opacity={0.28}
              />
            )}
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={l.color} strokeWidth={2.5}
              strokeDasharray={l.dashed ? '12 9' : undefined}
              strokeLinecap="round" opacity={0.75}
            />
            <g transform={`translate(${mx} ${my}) scale(${k})`}>
              <g
                style={clickable ? { cursor: 'pointer' } : undefined}
                onPointerDown={(e) => { if (clickable) { e.stopPropagation(); onEdit(l.id); } }}
                pointerEvents={clickable ? undefined : 'none'}
              >
                <rect x={-plateW / 2} y={-12} width={plateW} height={24} rx={12} fill={mix('var(--background)', 88)} stroke={athena ? mix('var(--accent)', 70) : mix(l.color, 55)} strokeWidth={1.25} />
                {athena && (
                  <circle cx={-plateW / 2 - 7} cy={0} r={3.5} fill="var(--accent)" data-testid={`mm-link-athena-${l.id}`}>
                    <title>{t.mastermind.athena_authored}</title>
                  </circle>
                )}
                <text y={4} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={mix(l.color, 85, 'var(--foreground)')} letterSpacing="0.02em" pointerEvents="none">
                  {l.label || '· · ·'}
                </text>
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}

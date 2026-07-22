// Shared integration route between two islands — bowed dotted arc (nautical
// register), trimmed by opacity rather than geometry so any island shape works.
// Hoisted out of the Archipelago variant once multiple variants needed it.
import { mix } from './ink';
import type { Island, IslandEdge } from './types';

export function Route({ e, a, b, lit }: { e: IslandEdge; a?: Island; b?: Island; lit: boolean }) {
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(130, len * 0.12);
  const cx = (a.x + b.x) / 2 - (dy / len) * bow;
  const cy = (a.y + b.y) / 2 + (dx / len) * bow;
  return (
    <path
      d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
      fill="none"
      stroke={mix('var(--primary)', 60, 'var(--muted-foreground)')}
      strokeWidth={e.kind === 'relation' ? 3 : 2}
      strokeDasharray="0.5 11"
      strokeLinecap="round"
      opacity={lit ? 0.95 : 0.28 + e.strength * 0.15}
      style={{ transition: 'opacity 200ms ease' }}
    />
  );
}

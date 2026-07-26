// Active-goals popover — opened from a project's Goals dimension cell. Lists
// the ongoing (not done) goal titles sorted by name; rows are deliberately
// inert for now (the per-goal action layer comes later). Chrome + dismissal
// come from the shared ListPopover shell.
import { Target } from 'lucide-react';

import { mix } from './ink';
import { ListPopover } from './ListPopover';

const COPY = { title: 'Active goals' };

export function GoalListPopover({ titles, x, y, onClose }: {
  titles: string[];
  /** Viewport-space anchor (clamped by the caller). */
  x: number;
  y: number;
  onClose: () => void;
}) {
  const sorted = [...titles].sort((a, b) => a.localeCompare(b));

  return (
    <ListPopover
      title={COPY.title}
      icon={Target}
      ink="var(--status-info)"
      trailing={sorted.length}
      x={x}
      y={y}
      testId="mm-goal-list"
      onClose={onClose}
    >
      {sorted.map((title) => (
        <li key={title} className="flex items-center gap-2.5 px-3 py-2 typo-body text-foreground/70">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mix('var(--status-info)', 85) }} aria-hidden />
          <span className="truncate">{title}</span>
        </li>
      ))}
    </ListPopover>
  );
}

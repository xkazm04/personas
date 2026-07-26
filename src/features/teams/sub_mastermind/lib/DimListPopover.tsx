// Generic "what's behind this cell" popover for dimensions whose whole payload
// is a short list of names — linked data projects, bound support channels. The
// cell already paints green/grey; this answers WHICH, the same way the goal and
// KPI popovers do for their dimensions. Rows are inert: these are declarations
// on the passport, not things to act on from the canvas.
import type { LucideIcon } from 'lucide-react';

import { mix } from './ink';
import { ListPopover } from './ListPopover';

export function DimListPopover({ title, icon, ink, items, x, y, testId, onClose }: {
  title: string;
  icon: LucideIcon;
  /** Theme token for the header icon + row dots (the dimension's status ink). */
  ink: string;
  items: string[];
  /** Viewport-space anchor (clamped by the caller). */
  x: number;
  y: number;
  testId: string;
  onClose: () => void;
}) {
  return (
    <ListPopover
      title={title}
      icon={icon}
      ink={ink}
      trailing={items.length}
      x={x}
      y={y}
      testId={testId}
      onClose={onClose}
    >
      {items.map((name) => (
        <li key={name} className="flex items-center gap-2.5 px-3 py-2 typo-body text-foreground/70">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mix(ink, 85) }} aria-hidden />
          <span className="truncate">{name}</span>
        </li>
      ))}
    </ListPopover>
  );
}

// Active-goals popover — opened from a project's Goals dimension cell. Lists
// the ongoing (not done) goal titles sorted by name; rows are deliberately
// inert for now (the per-goal action layer comes later). Styled to match the
// app's sidebar menus, like the persona/fleet list popovers.
import { useEffect, useRef } from 'react';
import { Target } from 'lucide-react';

import { mix } from './ink';

const COPY = { title: 'Active goals' };

export function GoalListPopover({ titles, x, y, onClose }: {
  titles: string[];
  /** Viewport-space anchor (clamped by the caller). */
  x: number;
  y: number;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const sorted = [...titles].sort((a, b) => a.localeCompare(b));

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-[248px] rounded-card border border-primary/15 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 overflow-hidden"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="mm-goal-list"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-primary/5">
        <Target className="w-4 h-4 shrink-0" style={{ color: 'var(--status-info)' }} aria-hidden />
        <span className="typo-label text-foreground/90">{COPY.title}</span>
        <span className="ml-auto typo-caption text-foreground/50 tabular-nums">{sorted.length}</span>
      </div>
      <ul className="max-h-[260px] overflow-y-auto py-1">
        {sorted.map((title) => (
          <li key={title} className="flex items-center gap-2.5 px-3 py-2 typo-body text-foreground/70">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mix('var(--status-info)', 85) }} aria-hidden />
            <span className="truncate">{title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

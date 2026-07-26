// Generic "what's behind this cell" popover for dimensions whose whole payload
// is a short list of names — linked data projects, bound support channels. The
// cell already paints green/grey; this answers WHICH, the same way the goal and
// KPI popovers do for their dimensions. Rows are inert: these are declarations
// on the passport, not things to act on from the canvas.
import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

import { mix } from './ink';

export function DimListPopover({ title, icon: Icon, ink, items, x, y, testId, onClose }: {
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
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-[248px] rounded-card border border-primary/15 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 overflow-hidden"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-primary/5">
        <Icon className="w-4 h-4 shrink-0" style={{ color: ink }} aria-hidden />
        <span className="typo-label text-foreground/90">{title}</span>
        <span className="ml-auto typo-caption text-foreground/50 tabular-nums">{items.length}</span>
      </div>
      <ul className="max-h-[260px] overflow-y-auto py-1">
        {items.map((name) => (
          <li key={name} className="flex items-center gap-2.5 px-3 py-2 typo-body text-foreground/70">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mix(ink, 85) }} aria-hidden />
            <span className="truncate">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

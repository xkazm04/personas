// In-progress personas popover — opened from the island's persona badge.
// Names only for now (list rows are deliberately inert; the per-persona
// action layer comes later). Styled to match the app's sidebar menus.
import { useEffect, useRef } from 'react';
import { Bot } from 'lucide-react';

import { mix } from './ink';

const COPY = { title: 'Personas in progress' };

export function PersonaListPopover({ names, x, y, onClose }: {
  names: string[];
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

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-[232px] rounded-card border border-primary/15 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 overflow-hidden"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="mm-persona-list"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-primary/5">
        <Bot className="w-4 h-4 shrink-0" style={{ color: 'var(--status-processing)' }} aria-hidden />
        <span className="typo-label text-foreground/90">{COPY.title}</span>
        <span className="ml-auto typo-caption text-foreground/50 tabular-nums">{names.length}</span>
      </div>
      <ul className="max-h-[240px] overflow-y-auto py-1">
        {names.map((name) => (
          <li key={name} className="flex items-center gap-2 px-3 py-2 typo-body text-foreground/70" onClick={onClose}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mix('var(--status-processing)', 85) }} aria-hidden />
            <span className="truncate">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

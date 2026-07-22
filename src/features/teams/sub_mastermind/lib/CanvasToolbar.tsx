// Bottom canvas toolbar — mouse-mode switch. View = pan/zoom; Edit = drag a
// project island to rearrange the map (position persists). Prototype copy is
// hardcoded (COPY const) pending consolidation i18n.
import { BoxSelect, Move, Spline } from 'lucide-react';

import type { CanvasMode } from './types';

const COPY = { edit: 'Edit', group: 'Group', connect: 'Connect', label: 'Canvas mode' };

const MODES: Array<{ id: CanvasMode; icon: typeof Move; label: string }> = [
  { id: 'edit', icon: Move, label: COPY.edit },
  { id: 'group', icon: BoxSelect, label: COPY.group },
  { id: 'connect', icon: Spline, label: COPY.connect },
];

export function CanvasToolbar({ mode, onModeChange }: { mode: CanvasMode; onModeChange: (m: CanvasMode) => void }) {
  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 p-1 rounded-interactive bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm"
      role="group"
      aria-label={COPY.label}
    >
      {MODES.map(({ id, icon: Icon, label }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            data-testid={`mm-mode-${id}`}
            onClick={() => onModeChange(id)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption font-medium transition-colors focus-ring ${
              active ? 'bg-primary/15 text-foreground' : 'text-foreground/70 hover:bg-primary/5 hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Bottom canvas toolbar — mouse-mode switch. View = pan/zoom; Edit = drag a
// project island to rearrange the map (position persists). Prototype copy is
// hardcoded (COPY const) pending consolidation i18n.
import { BoxSelect, Move, Spline, Type } from 'lucide-react';

import type { CanvasMode } from './types';

const COPY = { edit: 'Edit', group: 'Group', connect: 'Connect', note: 'Note', label: 'Canvas mode' };

// One-line orientation per mode — what the mouse does right now.
const HINTS: Record<CanvasMode, string> = {
  edit: 'Drag a header to move · click it for details',
  group: 'Drag on the canvas to draw a group',
  connect: 'Drag from one project to another',
  note: 'Click on the canvas to write a note',
};

const MODES: Array<{ id: CanvasMode; icon: typeof Move; label: string; key: string }> = [
  { id: 'edit', icon: Move, label: COPY.edit, key: 'E' },
  { id: 'group', icon: BoxSelect, label: COPY.group, key: 'G' },
  { id: 'connect', icon: Spline, label: COPY.connect, key: 'C' },
  { id: 'note', icon: Type, label: COPY.note, key: 'N' },
];

export function CanvasToolbar({ mode, onModeChange }: { mode: CanvasMode; onModeChange: (m: CanvasMode) => void }) {
  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 p-1 rounded-interactive bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm"
      role="group"
      aria-label={COPY.label}
    >
      {MODES.map(({ id, icon: Icon, label, key }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            data-testid={`mm-mode-${id}`}
            onClick={() => onModeChange(id)}
            aria-pressed={active}
            title={`${label} (${key})`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption font-medium transition-colors focus-ring ${
              active ? 'bg-primary/15 text-foreground' : 'text-foreground/70 hover:bg-primary/5 hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
      <span className="hidden sm:inline typo-caption text-foreground/55 border-l border-primary/15 pl-2.5 pr-1.5 ml-1 whitespace-nowrap">
        {HINTS[mode]}
      </span>
    </div>
  );
}

// Bottom canvas toolbar — mouse-mode switch. Edit = drag a project island to
// rearrange the map (position persists); Group/Connect/Note draw on the canvas.
import { BoxSelect, Move, Spline, Type } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

import type { CanvasMode } from './types';

const MODES: Array<{ id: CanvasMode; icon: typeof Move; key: string }> = [
  { id: 'edit', icon: Move, key: 'E' },
  { id: 'group', icon: BoxSelect, key: 'G' },
  { id: 'connect', icon: Spline, key: 'C' },
  { id: 'note', icon: Type, key: 'N' },
];

const modeLabel = (t: Translations, id: CanvasMode) =>
  ({ edit: t.mastermind.mode_edit, group: t.mastermind.mode_group, connect: t.mastermind.mode_connect, note: t.mastermind.mode_note })[id];

// One-line orientation per mode — what the mouse does in it.
const modeHint = (t: Translations, id: CanvasMode) =>
  ({ edit: t.mastermind.hint_edit, group: t.mastermind.hint_group, connect: t.mastermind.hint_connect, note: t.mastermind.hint_note })[id];

export function CanvasToolbar({ mode, onModeChange }: { mode: CanvasMode; onModeChange: (m: CanvasMode) => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 p-1 max-w-[calc(100vw-6.5rem)] rounded-interactive mm-chrome surface-blur-tooltip"
      role="group"
      aria-label={t.mastermind.toolbar_label}
    >
      {MODES.map(({ id, icon: Icon, key }) => {
        const active = mode === id;
        const label = modeLabel(t, id);
        // The hint used to occupy a second row of the toolbar, which is what
        // pushed the cluster to two lines on narrow canvases. It now rides on
        // EVERY mode's own tooltip rather than only describing the active one:
        // the orientation is available before you commit to a mode, and the
        // toolbar is a single row at every width.
        return (
          <Tooltip key={id} content={`${label} (${key}) — ${modeHint(t, id)}`}>
            <button
              type="button"
              data-testid={`mm-mode-${id}`}
              onClick={() => onModeChange(id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption font-medium transition-colors focus-ring ${
                active ? 'bg-primary/20 text-foreground' : 'text-foreground/65 hover:bg-primary/10 hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden />
              {label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

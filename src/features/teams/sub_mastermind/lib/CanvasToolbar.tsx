// Bottom canvas toolbar — mouse-mode switch. Edit = drag a project island to
// rearrange the map (position persists); Group/Connect/Note draw on the canvas.
import { BoxSelect, Move, Spline, Type } from 'lucide-react';

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

// One-line orientation per mode — what the mouse does right now.
const modeHint = (t: Translations, id: CanvasMode) =>
  ({ edit: t.mastermind.hint_edit, group: t.mastermind.hint_group, connect: t.mastermind.hint_connect, note: t.mastermind.hint_note })[id];

export function CanvasToolbar({ mode, onModeChange }: { mode: CanvasMode; onModeChange: (m: CanvasMode) => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex flex-wrap justify-center items-center gap-1 p-1 max-w-[calc(100vw-6.5rem)] rounded-interactive bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm"
      role="group"
      aria-label={t.mastermind.toolbar_label}
    >
      {MODES.map(({ id, icon: Icon, key }) => {
        const active = mode === id;
        const label = modeLabel(t, id);
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
      {/* The hint is the only thing on screen that says what the mouse does in
          the current (sticky, global) mode — so it survives every width. It
          used to be `hidden sm:inline`, which dropped the one affordance that
          recovers a lost user exactly when space got tight. Now it wraps onto
          its own row instead: full-width and centred when the modes no longer
          fit beside it, inline with a divider once they do. */}
      <span className="basis-full order-last text-center pt-1 sm:basis-auto sm:order-none sm:text-left sm:pt-0 sm:border-l sm:border-primary/15 sm:pl-2.5 sm:ml-1 pr-1.5 min-w-0 truncate typo-caption text-foreground/55">
        {modeHint(t, mode)}
      </span>
    </div>
  );
}

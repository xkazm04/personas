// Session-list popover for the Badges fleet treatment: lists the island's
// terminals in one state (animal glyph + label — the same identity the Cells
// treatment paints), pick one to open its preview.
import { FLEET_INK, mix } from './ink';
import { animalIcon } from './fleetMeta';
import type { FleetNode } from './types';

export function FleetListPopover({ sessions, state, x, y, onPick, onClose }: {
  sessions: FleetNode[];
  state: string;
  /** Screen-space anchor (clamped by the caller). */
  x: number;
  y: number;
  onPick: (sessionId: string) => void;
  onClose: () => void;
}) {
  const ink = FLEET_INK[state] ?? 'var(--status-neutral)';
  return (
    <div
      className="absolute z-30 w-[232px] py-1.5 rounded-card border border-primary/20 bg-secondary/95 shadow-elevation-3 overflow-hidden"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="mm-fleet-list"
    >
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-0.5 border-b border-foreground/10">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ink }} aria-hidden />
        <span className="typo-caption font-semibold text-foreground">{state.replace('_', ' ')}</span>
        <span className="typo-caption text-foreground/45 ml-auto">{sessions.length}</span>
      </div>
      <ul className="max-h-[240px] overflow-y-auto py-0.5">
        {sessions.map((f) => {
          const Animal = animalIcon(f.id);
          return (
            <li key={f.id}>
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-primary/10 transition-colors"
                onClick={() => { onPick(f.id); onClose(); }}
                data-testid={`mm-fleet-list-${f.id}`}
              >
                <Animal className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: mix(ink, 85, 'var(--foreground)') }} aria-hidden />
                <span className="typo-caption text-foreground/90 truncate">{f.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

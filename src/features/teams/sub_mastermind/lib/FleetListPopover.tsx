// Session-list popover for the Badges fleet treatment: lists the island's
// terminals in one state (animal glyph + label — the same identity the Cells
// treatment paints), pick one to open its preview. Anchored INSIDE the canvas
// shell, which owns Escape/sea-click dismissal — hence `anchor="absolute"`.
import { animalIcon } from './fleetMeta';
import { FLEET_INK, mix } from './ink';
import { ListPopover } from './ListPopover';
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
    <ListPopover
      title={state.replace('_', ' ')}
      ink={ink}
      dot
      trailing={sessions.length}
      x={x}
      y={y}
      width={232}
      maxListHeight={240}
      anchor="absolute"
      testId="mm-fleet-list"
      onClose={onClose}
    >
      {sessions.map((f) => {
        const Animal = animalIcon(f.id);
        return (
          <li key={f.id}>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md typo-body transition-colors text-foreground/70 hover:bg-secondary/40 hover:text-foreground"
              onClick={() => { onPick(f.id); onClose(); }}
              data-testid={`mm-fleet-list-${f.id}`}
            >
              <Animal className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: mix(ink, 85, 'var(--foreground)') }} aria-hidden />
              <span className="truncate">{f.label}</span>
            </button>
          </li>
        );
      })}
    </ListPopover>
  );
}

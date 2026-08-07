// Session-list popover for the fleet ops treatments: lists the island's
// terminals (animal glyph + label — the same identity the Cells treatment
// paints), pick one to open its preview. Two callers, two filters: the
// per-state badges pass a single session state; the mid band's fleet face
// passes `'all'` (every live session, each row in its own state's ink).
// Anchored INSIDE the canvas shell, which owns Escape/sea-click dismissal —
// hence `anchor="absolute"`.
import { useTranslation } from '@/i18n/useTranslation';

import { animalIcon, fleetStateLabel } from './fleetMeta';
import { FLEET_INK, mix } from './ink';
import { ListPopover } from './ListPopover';
import type { FleetNode } from './types';

export function FleetListPopover({ sessions, state, x, y, onPick, onClose }: {
  sessions: FleetNode[];
  /** A session state, or `'all'` for the unfiltered live list. */
  state: string;
  /** Screen-space anchor (clamped by the caller). */
  x: number;
  y: number;
  onPick: (sessionId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const all = state === 'all';
  // Header: the state's own translated label (never the raw machine token),
  // or the lane name when the list is unfiltered.
  const title = all ? t.mastermind.family_fleet : fleetStateLabel(t, state);
  const headerInk = all ? 'var(--status-processing)' : FLEET_INK[state] ?? 'var(--status-neutral)';
  return (
    <ListPopover
      title={title}
      ink={headerInk}
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
        // Unfiltered list: each row wears its OWN session's state ink — the
        // mixed list must still say which session is in which state.
        const ink = all ? FLEET_INK[f.state] ?? 'var(--status-neutral)' : headerInk;
        return (
          <li key={f.id}>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-input typo-body transition-colors text-foreground/70 hover:bg-secondary/40 hover:text-foreground"
              onClick={() => { onPick(f.id); onClose(); }}
              data-testid={`mm-fleet-list-${f.id}`}
            >
              <Animal className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: mix(ink, 85, 'var(--foreground)') }} aria-hidden />
              <span className="truncate flex-1">{f.label}</span>
              {all && (
                <span className="typo-caption text-foreground/50 shrink-0">{fleetStateLabel(t, f.state)}</span>
              )}
            </button>
          </li>
        );
      })}
    </ListPopover>
  );
}

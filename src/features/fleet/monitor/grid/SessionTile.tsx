// SessionTile — a live Claude (Fleet) session on the classic board.
//
// Was `SessionSquare`, then a 152×30 single-line tile; it is now a THIN
// WRAPPER over `board/node/FleetNode`, which paints the two-row node every
// kind on the board shares. What this wrapper keeps is what a session DOES on
// the classic board, and none of it changed:
//   • the body opens the session's terminal (`FleetTerminalModal`, which works
//     in every build) — absent `onOpen`, the tile is read-only and inert;
//   • the trailing icon opens the RECAP — the cheap read that mounts no xterm,
//     an answer to "what is this one doing" an operator can afford twenty
//     times in a row. It is a SIBLING of the body, never a child: a control
//     inside a control is invalid, and the outer one would swallow its clicks.
//     It sits at reduced opacity and rises on hover or keyboard focus, but it
//     is never hidden — an affordance revealed only by hover does not exist on
//     touch;
//   • `data-testid="fleet-grid-session"` on the body, `fleet-grid-session-recap`
//     on the icon.
// The node reads the state's hue from the canonical fleet palette
// (`fleetSessionModel`), so a session never wears violet here and blue there.

import { memo } from 'react';
import { ScanEye } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { sessionLabel, sessionStateMeta } from './fleetSessionModel';
import { FleetNode } from './board/node/FleetNode';

export const SessionTile = memo(function SessionTile({
  session, width, height, onOpen, onRecap, flash = false,
}: {
  session: FleetSession;
  width: number;
  height: number;
  /** Athena pointed at this node — ring it until the board clears the signal. */
  flash?: boolean;
  /** Open this session's terminal. Absent = the tile stays read-only. */
  onOpen?: (session: FleetSession) => void;
  /** Open the session's recap. Absent = no recap affordance. */
  onRecap?: (session: FleetSession) => void;
}) {
  const { t } = useTranslation();
  const meta = sessionStateMeta(session.state);
  const stateLabel = t.plugins.fleet[meta.labelKey];
  const label = sessionLabel(session);
  const title = [label, stateLabel, session.projectLabel].filter(Boolean).join(' · ');

  return (
    <FleetNode
      kind="session"
      session={session}
      width={width}
      height={height}
      flash={flash}
      onActivate={onOpen ? () => onOpen(session) : undefined}
      ariaLabel={title}
      tooltip={title}
      bodyTestId="fleet-grid-session"
      data={{ state: session.state }}
      trailing={onOpen && onRecap ? (
        <Tooltip content={t.monitor.grid_session_recap_open}>
          <button
            type="button"
            onClick={() => onRecap(session)}
            aria-label={t.monitor.grid_session_recap_open}
            data-testid="fleet-grid-session-recap"
            className="focus-ring flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-foreground opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <ScanEye className="h-3 w-3" aria-hidden />
          </button>
        </Tooltip>
      ) : undefined}
    />
  );
});

export default SessionTile;

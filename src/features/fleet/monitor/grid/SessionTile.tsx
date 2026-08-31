// SessionTile — a live Claude (Fleet) session on the Activity board.
//
// Was `SessionSquare`, and keeps every distinction that component earned: a
// session is a temporary process the operator dispatched, not a permanent member
// of the fleet, so it is SHORTER than a persona tile and HOLLOW rather than
// filled, and its border carries the lifecycle state from the canonical fleet
// palette (see fleetSessionModel).
//
// What the extra width buys: the 2–3 character `sessionGlyph` was a compression
// forced by a 30px square — "build api docs" became "BAD". At tile width the
// session's real label fits, and the glyph is retired from this surface (the
// helper stays; the compact fleet chips still use it).
//
// IT IS A BUTTON NOW, and the follow-up its header used to carry is closed. The
// old note was right at the time: the only "open this terminal" affordance in
// the app depended on `FleetGridLayer`, which `App.tsx` mounts behind
// `import.meta.env.DEV`, so a wired click would have done nothing in a
// production build and a read-only square was the honest failure. The Monitor
// now has its own host — `FleetTerminalModal` — which works in every build, so
// the tile can finally do the thing it always looked like it did.

import { memo } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { SESSION_BORDER, sessionLabel, sessionStateMeta } from './fleetSessionModel';

export const SessionTile = memo(function SessionTile({
  session, width, height, onOpen,
}: {
  session: FleetSession;
  width: number;
  height: number;
  /** Open this session's terminal. Absent = the tile stays read-only. */
  onOpen?: (session: FleetSession) => void;
}) {
  const { t } = useTranslation();
  const meta = sessionStateMeta(session.state);
  const stateLabel = t.plugins.fleet[meta.labelKey];
  const label = sessionLabel(session);
  const title = [label, stateLabel, session.projectLabel].filter(Boolean).join(' · ');

  const body = (
    <>
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${meta.dot}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate typo-caption ${meta.text}`}>{label}</span>
    </>
  );
  const cls = `flex flex-shrink-0 items-center gap-1.5 overflow-hidden rounded-input border-[1.5px] border-dashed px-2 ${SESSION_BORDER[session.state]} ${meta.chip}`;

  if (!onOpen) {
    return (
      <span
        role="img"
        title={title}
        aria-label={title}
        data-state={session.state}
        data-testid="fleet-grid-session"
        className={cls}
        style={{ width, height }}
      >
        {body}
      </span>
    );
  }

  // The shared Tooltip, not `title=` — this branch is INTERACTIVE, and a native
  // tooltip on a control is unreachable by keyboard and absent on touch, which
  // is exactly the condition the tooltip golden path gates. The read-only span
  // above keeps its `title`: it is not a control, and there is nothing to reach.
  return (
    <Tooltip content={title}>
      <button
        type="button"
        onClick={() => onOpen(session)}
        aria-label={title}
        data-state={session.state}
        data-testid="fleet-grid-session"
        className={`${cls} focus-ring transition-colors hover:brightness-125`}
        style={{ width, height }}
      >
        {body}
      </button>
    </Tooltip>
  );
});

export default SessionTile;

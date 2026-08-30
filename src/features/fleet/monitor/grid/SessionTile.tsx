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
// Still not a button, for the reason the square was not: the only "open this
// session's terminal" affordance depends on `FleetGridLayer`, which App.tsx
// mounts behind `import.meta.env.DEV`, so a wired click would do nothing in a
// production build. Follow-up: un-gate that host (or give the Monitor its own).

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { SESSION_BORDER, sessionLabel, sessionStateMeta } from './fleetSessionModel';

export const SessionTile = memo(function SessionTile({
  session, width, height,
}: {
  session: FleetSession;
  width: number;
  height: number;
}) {
  const { t } = useTranslation();
  const meta = sessionStateMeta(session.state);
  const stateLabel = t.plugins.fleet[meta.labelKey];
  const label = sessionLabel(session);
  const title = [label, stateLabel, session.projectLabel].filter(Boolean).join(' · ');

  return (
    <span
      role="img"
      title={title}
      aria-label={title}
      data-state={session.state}
      data-testid="fleet-grid-session"
      className={`flex flex-shrink-0 items-center gap-1.5 overflow-hidden rounded-input border-[1.5px] border-dashed px-2 ${SESSION_BORDER[session.state]} ${meta.chip}`}
      style={{ width, height }}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${meta.dot}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate typo-caption ${meta.text}`}>{label}</span>
    </span>
  );
});

export default SessionTile;

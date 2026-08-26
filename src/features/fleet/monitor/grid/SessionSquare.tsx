// SessionSquare — a live Claude (Fleet) session on the Activity board.
//
// Smaller than a PersonaSquare and hollow rather than filled, so the two never
// read as the same kind of thing: a persona is a permanent member of the fleet,
// a session is a temporary process the operator dispatched. Its BORDER carries
// the lifecycle state, using the canonical fleet palette (see fleetSessionModel).
//
// Not a button on purpose. The only existing "open this session's terminal"
// affordance — `fleetSetActiveSession` + `fleetSetGridOpen` — depends on
// `FleetGridLayer`, which App.tsx mounts behind `import.meta.env.DEV`. Wiring
// the click would therefore do nothing in a production build, which is worse
// than an honest read-only square. Follow-up: un-gate that host (or give the
// Monitor its own) and turn this into a button.

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { SESSION_BORDER, sessionGlyph, sessionLabel, sessionStateMeta } from './fleetSessionModel';

export const SessionSquare = memo(function SessionSquare({
  session, size = 30,
}: {
  session: FleetSession;
  size?: number;
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
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-input border-[1.5px] ${SESSION_BORDER[session.state]} ${meta.chip}`}
      style={{ width: size, height: size }}
    >
      <span className={`text-[9px] font-bold leading-none tracking-tight ${meta.text}`}>
        {sessionGlyph(session)}
      </span>
    </span>
  );
});

export default SessionSquare;

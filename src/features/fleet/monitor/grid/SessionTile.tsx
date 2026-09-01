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
import { ScanEye } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { SESSION_BORDER, sessionLabel, sessionStateMeta } from './fleetSessionModel';

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
  /**
   * Open the session's RECAP — the cheap read that mounts no xterm. Absent =
   * no recap affordance (the read-only tile has no controls at all).
   */
  onRecap?: (session: FleetSession) => void;
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
  const cls = `flex flex-shrink-0 items-center gap-1.5 overflow-hidden rounded-input border-[1.5px] border-dashed px-2 ${SESSION_BORDER[session.state]} ${meta.chip} ${
    flash ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
  }`;

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
  //
  // TWO affordances now, and they are priced very differently. The TILE opens
  // the live terminal, which attaches a PTY subscription and mounts an xterm.
  // The trailing ICON opens the RECAP, which reads the transcript tail and
  // mounts nothing — the answer to "what is this one doing" at a price an
  // operator can pay twenty times in a row. The icon is a sibling of the tile
  // button, never a child: a control inside a control is invalid, and the outer
  // one would swallow its clicks.
  //
  // Icon-only, and no new text on the tile face — the tile is 152px wide and
  // every pixel of it is already spoken for by the session's own label. It sits
  // at reduced opacity and rises on hover or keyboard focus, but it is never
  // hidden: an affordance revealed only by hover does not exist on touch.
  return (
    <span className="relative flex flex-shrink-0" style={{ width, height }}>
      <Tooltip content={title}>
        <button
          type="button"
          onClick={() => onOpen(session)}
          aria-label={title}
          data-state={session.state}
          data-testid="fleet-grid-session"
          className={`${cls} focus-ring h-full w-full transition-colors hover:brightness-125 ${onRecap ? 'pr-6' : ''}`}
        >
          {body}
        </button>
      </Tooltip>
      {onRecap && (
        <Tooltip content={t.monitor.grid_session_recap_open}>
          <button
            type="button"
            onClick={() => onRecap(session)}
            aria-label={t.monitor.grid_session_recap_open}
            data-testid="fleet-grid-session-recap"
            className="focus-ring absolute inset-y-0 right-0 my-auto mr-1 flex h-4 w-4 items-center justify-center rounded-full text-foreground opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <ScanEye className="h-3 w-3" aria-hidden />
          </button>
        </Tooltip>
      )}
    </span>
  );
});

export default SessionTile;

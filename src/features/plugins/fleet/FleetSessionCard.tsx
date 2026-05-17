import { memo, useCallback } from 'react';
import { X } from 'lucide-react';
import { toastCatch } from '@/lib/silentCatch';
import { killSession, removeSession } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { FleetStatusDots } from './FleetStatusDots';

/**
 * Compact one-row session card for the left panel.
 *
 * Surfaces only what scales to a list of 5-10 parallel sessions:
 *   [● ●] project-name                                    [×]
 *
 * The two dots are the {console, business} state pair (see FleetStatusDots).
 * Click anywhere on the row to focus the session in the right pane. Click X
 * to kill (if alive) or drop (if exited).
 *
 * Memoized — when other sessions update, this card's props are unchanged
 * (slice patchSession preserves untouched session object identities) and
 * React.memo bails the render.
 */
interface Props {
  session: FleetSession;
  isActive: boolean;
  onActivate: (id: string) => void;
  onRemovedLocal: (id: string) => void;
}

function FleetSessionCardImpl({ session, isActive, onActivate, onRemovedLocal }: Props) {
  const handleOpen = useCallback(() => onActivate(session.id), [session.id, onActivate]);

  const handleClose = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        if (session.state === 'exited') {
          await removeSession(session.id);
          onRemovedLocal(session.id);
        } else {
          await killSession(session.id);
        }
      } catch (err) {
        toastCatch('FleetSessionCard:close', 'Failed to close session')(err);
      }
    },
    [session.id, session.state, onRemovedLocal],
  );

  return (
    <button
      type="button"
      onClick={handleOpen}
      data-testid={`fleet-session-row-${session.id}`}
      data-active={isActive || undefined}
      className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-card border transition-colors text-left ${
        isActive
          ? 'border-primary/30 bg-primary/8'
          : 'border-transparent hover:border-primary/15 hover:bg-secondary/30'
      }`}
      title={session.cwd}
    >
      <FleetStatusDots state={session.state} reason={session.stateReason} />
      <span className="typo-caption font-medium truncate flex-1 min-w-0">
        {session.projectLabel}
      </span>
      <span
        role="button"
        tabIndex={0}
        aria-label={session.state === 'exited' ? 'Remove from list' : 'Kill session'}
        onClick={handleClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClose(e as unknown as React.MouseEvent);
          }
        }}
        className="opacity-40 group-hover:opacity-100 hover:text-red-400 transition-opacity p-0.5 rounded -mr-0.5 flex-shrink-0"
      >
        <X className="w-3 h-3" />
      </span>
    </button>
  );
}

export const FleetSessionCard = memo(FleetSessionCardImpl, (prev, next) =>
  prev.session === next.session &&
  prev.isActive === next.isActive &&
  prev.onActivate === next.onActivate &&
  prev.onRemovedLocal === next.onRemovedLocal,
);

// FleetTerminalModal — a live session's terminal, opened from its board tile.
//
// A fleet session is not a member of the fleet, it is a PROCESS: spawned by the
// operator or by Athena to carry one task, and gone once the task lands or
// someone kills it. The Activity board has always shown them — a hollow tile
// under each team's roster — and until now that tile was the end of the road.
// `SessionTile`'s own header recorded why: the only "open this terminal"
// affordance in the app depended on `FleetGridLayer`, which `App.tsx` mounts
// behind `import.meta.env.DEV`, so wiring the click would have done nothing in a
// production build and an honest read-only square was the better failure.
//
// This is the host that removes that excuse. It is the Monitor's own, it works
// in every build, and it reuses `FleetTerminalPane` — which means it inherits
// the whole of `fleetTerminalManager`'s design rather than re-implementing any
// of it: the xterm instance for this session already exists and is parked in a
// detached holder, so opening this ATTACHES (subscribes to live PTY output and
// replays the backend ring) and closing DETACHES rather than disposes. The
// scrollback survives, and an unwatched session costs nothing.
//
// That last property is why this modal can exist at all on a board showing
// hundreds of sessions: work tracks watched sessions, not running ones.

import { useCallback, useState } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AsyncButton } from '@/features/shared/components/buttons';
import { FleetTerminalPane } from '@/features/plugins/fleet/FleetTerminalPane';
import { killSession } from '@/api/fleet/fleet';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { sessionLabel, sessionStateMeta } from './fleetSessionModel';

const TITLE_ID = 'fleet-terminal-modal-title';

export function FleetTerminalModal({
  session, onClose,
}: {
  /** Null closes it. */
  session: FleetSession | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [killing, setKilling] = useState(false);

  const kill = useCallback(async () => {
    if (!session || killing) return;
    setKilling(true);
    try {
      await killSession(session.id);
      // The registry emits `fleet-session-exited`; the board's own listener
      // patches the row. Nothing to write here — a second write path into a
      // list the store already owns is how two copies of one fleet disagree.
      onClose();
    } catch (e) {
      toastCatch('fleet-terminal:kill')(e);
    } finally {
      setKilling(false);
    }
  }, [session, killing, onClose]);

  if (!session) return null;

  const meta = sessionStateMeta(session.state);
  const label = sessionLabel(session);
  // A session with no PTY on this side (restored after a restart, headless, or
  // already exited) has no terminal to attach. Saying so beats a black box the
  // operator cannot tell from a session that has not printed yet.
  const attachable = session.state !== 'exited';

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-4xl"
      staggerChildren={false}
      panelClassName="h-[76vh] flex flex-col"
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
          <Terminal className="h-3.5 w-3.5 text-foreground" />
        </div>
        <h2 id={TITLE_ID} className="min-w-0 truncate typo-title">{label}</h2>
        <span
          className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 typo-caption ${meta.chip} ${meta.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
          {t.plugins.fleet[meta.labelKey]}
        </span>
        {session.projectLabel && (
          <span className="min-w-0 truncate typo-caption text-foreground opacity-50">
            {session.projectLabel}
          </span>
        )}
        <span className="ml-auto flex-shrink-0">
          <AsyncButton
            onClick={kill}
            disabled={killing || !attachable}
            variant="secondary"
            size="sm"
            data-testid="fleet-terminal-kill"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t.monitor.grid_fleet_kill}
          </AsyncButton>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2" data-testid="fleet-terminal-modal">
        {attachable ? (
          <FleetTerminalPane sessionId={session.id} className="h-full" />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="typo-body text-foreground opacity-55">{t.monitor.grid_fleet_exited}</p>
          </div>
        )}
      </div>
    </BaseModal>
  );
}

export default FleetTerminalModal;

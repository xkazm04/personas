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

import { useCallback, useEffect, useState } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AsyncButton } from '@/features/shared/components/buttons';
import { FleetTerminalPane } from '@/features/plugins/fleet/FleetTerminalPane';
import { killSession, wakeSession } from '@/api/fleet/fleet';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { sessionLabel, sessionStateMeta } from './fleetSessionModel';
import { isSleeping, NoTerminalPanel, SessionReplyBar, SleepingSessionPanel } from './FleetTerminalFallback';

const TITLE_ID = 'fleet-terminal-modal-title';

export function FleetTerminalModal({
  session, onClose,
}: {
  /** Null closes it. */
  session: FleetSession | null;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const [killing, setKilling] = useState(false);

  // The modal FOLLOWS the session rather than freezing the row it was opened
  // with: its state moves while it is open, and a wake replaces the row with a
  // new id (`fleet_wake_session`), which the modal must track to show the
  // resumed terminal instead of the tombstone it just left.
  const [currentId, setCurrentId] = useState<string | null>(session?.id ?? null);
  useEffect(() => { setCurrentId(session?.id ?? null); }, [session?.id]);
  const liveRow = useSystemStore((st) => st.fleetSessions.find((s) => s.id === currentId) ?? null);
  const fleetRefresh = useSystemStore((st) => st.fleetRefresh);
  const row = liveRow ?? (session && session.id === currentId ? session : null);

  const kill = useCallback(async () => {
    if (!row || killing) return;
    setKilling(true);
    try {
      await killSession(row.id);
      // The registry emits `fleet-session-exited`; the board's own listener
      // patches the row. Nothing to write here — a second write path into a
      // list the store already owns is how two copies of one fleet disagree.
      onClose();
    } catch (e) {
      toastCatch('fleet-terminal:kill')(e);
    } finally {
      setKilling(false);
    }
  }, [row, killing, onClose]);

  const wake = useCallback(async () => {
    if (!row) return;
    try {
      const newId = await wakeSession(row.id);
      // Hold the button busy until the resumed row is in the store, so the pane
      // never attaches to an id the registry snapshot has not caught up with.
      await fleetRefresh();
      setCurrentId(newId);
    } catch (e) {
      toastCatch('fleet-terminal:wake')(e);
    }
  }, [row, fleetRefresh]);

  if (!session || !row) return null;

  const meta = sessionStateMeta(row.state);
  const label = sessionLabel(row);
  const f = t.plugins.fleet;
  // Four bodies, one per kind of row. Only a live interactive process has a
  // terminal; every other row used to fall through to a black pane.
  const sleeping = isSleeping(row);
  const exited = row.state === 'exited';
  const headless = row.mode === 'headless';
  const queued = row.state === 'queued';
  const live = !sleeping && !exited && !headless && !queued;
  const stateText = sleeping ? tx(f.monitor_dozing_suffix, { state: f[meta.labelKey] }) : f[meta.labelKey];

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
          {stateText}
        </span>
        {row.projectLabel && (
          <span className="min-w-0 truncate typo-caption text-foreground">
            {row.projectLabel}
          </span>
        )}
        <span className="ml-auto flex-shrink-0">
          <AsyncButton
            onClick={kill}
            disabled={killing || !live}
            variant="secondary"
            size="sm"
            data-testid="fleet-terminal-kill"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t.monitor.grid_fleet_kill}
          </AsyncButton>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2" data-testid="fleet-terminal-modal" data-kind={live ? 'live' : sleeping ? 'sleeping' : 'none'}>
        {live ? (
          <FleetTerminalPane key={row.id} sessionId={row.id} className="h-full" />
        ) : sleeping ? (
          <SleepingSessionPanel session={row} onWake={wake} />
        ) : (
          <NoTerminalPanel text={exited ? t.monitor.grid_fleet_exited : headless ? f.headless_no_terminal : f.state_queued} />
        )}
      </div>
      {live && row.state === 'awaiting_input' && <SessionReplyBar session={row} />}
    </BaseModal>
  );
}

export default FleetTerminalModal;

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
import { MoonStar, Terminal, Trash2 } from 'lucide-react';
import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { AsyncButton } from '@/features/shared/components/buttons';
import { FleetTerminalPane } from '@/features/plugins/fleet/FleetTerminalPane';
import { killSession, removeSession, wakeSession } from '@/api/fleet/fleet';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDestructiveModal, useConfirmDestructive } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
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
  /**
   * The last wake's refusal. Shown IN the modal: the modal sits on the portal
   * tier (z 10000) and toasts render at z 50, so a toast-only failure was
   * invisible and the Wake button read as dead.
   */
  const [wakeError, setWakeError] = useState<unknown>(null);

  // The modal FOLLOWS the session rather than freezing the row it was opened
  // with: its state moves while it is open, and a wake replaces the row with a
  // new id (`fleet_wake_session`), which the modal must track to show the
  // resumed terminal instead of the tombstone it just left.
  const [currentId, setCurrentId] = useState<string | null>(session?.id ?? null);
  useEffect(() => { setCurrentId(session?.id ?? null); }, [session?.id]);
  useEffect(() => { setWakeError(null); }, [currentId]);
  const liveRow = useSystemStore((st) => st.fleetSessions.find((s) => s.id === currentId) ?? null);
  const fleetRefresh = useSystemStore((st) => st.fleetRefresh);
  // Keep painting the last row we had while a woken id has not reached the
  // store yet, instead of unmounting the whole modal for a frame (or for good).
  const [lastRow, setLastRow] = useState<FleetSession | null>(null);
  useEffect(() => { if (liveRow) setLastRow(liveRow); }, [liveRow]);
  const row = liveRow ?? (session && session.id === currentId ? session : lastRow);

  const doKill = useCallback(async () => {
    if (!row || killing) return;
    setKilling(true);
    try {
      // A live process is killed; a sleeping row has NO process (that is what
      // asleep means), so "kill" drops its tombstone from the registry -
      // `fleet_kill_session` would only null handles that are already null and
      // leave the row on the board.
      if (isSleeping(row)) await removeSession(row.id);
      else await killSession(row.id);
      // The registry emits the change; the board's own listener patches the
      // row. Nothing to write here.
      onClose();
    } catch (e) {
      toastCatch('fleet-terminal:kill')(e);
      setWakeError(e);
    } finally {
      setKilling(false);
    }
  }, [row, killing, onClose]);

  // Killing a live session ends a running process, and killing a SLEEPING one
  // drops its tombstone from the registry - neither comes back. The door was
  // reachable in one click with no confirmation anywhere in the file
  // (`unconsented-irreversible-door`), which is the condition that rule exists
  // for. The copy reuses the keys the remote-kill path already ships; the
  // session's project label fills the slot the remote flow fills with a device.
  const { modal: killModal, confirm: askKill } = useConfirmDestructive();
  const kill = useCallback(() => {
    if (!row || killing) return;
    askKill({
      title: tx(t.monitor.remote_kill_confirm_title, { device: row.projectLabel || row.id }),
      message: tx(t.monitor.remote_kill_confirm_body, { device: row.projectLabel || row.id }),
      confirmLabel: t.monitor.remote_kill,
      onConfirm: doKill,
    });
  }, [row, killing, askKill, doKill, t, tx]);

  const wake = useCallback(async () => {
    if (!row) return;
    setWakeError(null);
    try {
      const newId = await wakeSession(row.id);
      // Hold the button busy until the resumed row is in the store, so the pane
      // never attaches to an id the registry snapshot has not caught up with.
      await fleetRefresh();
      setCurrentId(newId);
    } catch (e) {
      silentCatch('fleet-terminal:wake')(e);
      setWakeError(e);
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
  // Kill is a live process's action, and a sleeping row's ONLY way out once a
  // wake has been refused (the operator asked for exactly that offer).
  const canKill = live || (sleeping && wakeError !== null);

  const footer = live && row.state === 'awaiting_input'
    ? <SessionReplyBar session={row} />
    : sleeping
      ? (
        <AsyncButton
          variant="primary"
          size="sm"
          onClick={wake}
          disabled={!row.claudeSessionId}
          icon={<MoonStar className="h-3.5 w-3.5" />}
          autoFocus
          data-testid="fleet-terminal-wake"
        >
          {f.wake_session}
        </AsyncButton>
      )
      : undefined;

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      width="lg"
      portal
      icon={<Terminal className="h-5 w-5" />}
      title={label}
      status={
        <>
          <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 typo-caption ${meta.chip} ${meta.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
            {stateText}
          </span>
          {row.projectLabel && <span className="min-w-0 truncate typo-caption">{row.projectLabel}</span>}
        </>
      }
      actions={
        <AsyncButton
          onClick={kill}
          disabled={killing || !canKill}
          variant="secondary"
          size="sm"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          data-testid="fleet-terminal-kill"
        >
          {t.monitor.grid_fleet_kill}
        </AsyncButton>
      }
      footer={footer}
    >
      <div data-testid="fleet-terminal-modal" data-kind={live ? 'live' : sleeping ? 'sleeping' : 'none'}>
        {live ? (
          <div className="h-[58vh] overflow-hidden rounded-card border border-primary/10 bg-background">
            <FleetTerminalPane key={row.id} sessionId={row.id} className="h-full" />
          </div>
        ) : sleeping ? (
          <SleepingSessionPanel session={row} wakeError={wakeError} />
        ) : (
          <NoTerminalPanel text={exited ? t.monitor.grid_fleet_exited : headless ? f.headless_no_terminal : f.state_queued} />
        )}
      </div>
      {/* The consent door for `kill`. Inside the shell so it stacks above this
          modal rather than behind it. */}
      <ConfirmDestructiveModal {...killModal} />
    </ModalShell>
  );
}

export default FleetTerminalModal;

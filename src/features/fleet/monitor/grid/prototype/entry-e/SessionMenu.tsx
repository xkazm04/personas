// The session card's verbs, one right-click away (or Shift+F10 / the Menu key
// on a focused card): open its terminal, open its recap, kill the process,
// delete the card. ONE host owns the menu and the two confirms, and every card
// on every layout binds to it, so a board of fifty cards mounts one menu.
//
// Delete = kill (while a process may still run) then drop the registry row.
// `fleet_remove_session` emits `removed` on the registry channel, which the
// fleet slice folds into `fleetSessions` itself - no manual refresh needed.

import { createContext, useCallback, useContext, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ScanEye, SquareTerminal, Trash2, XOctagon } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { killSession, removeSession } from '@/api/fleet/fleet';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { sessionLabel } from '../../fleetSessionModel';

type Open = (session: FleetSession, x: number, y: number) => void;
const MenuContext = createContext<Open | null>(null);

/** A process may still be attached: anything not already gone. */
const mayBeLive = (s: FleetSession) => s.state !== 'exited' && s.state !== 'hibernated';

export function SessionMenuProvider({
  children, onOpenTerminal, onOpenRecap,
}: {
  children: ReactNode;
  onOpenTerminal: (s: FleetSession) => void;
  onOpenRecap: (s: FleetSession) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ session: FleetSession; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'kill' | 'delete'; session: FleetSession } | null>(null);
  const open = useCallback<Open>((session, x, y) => setMenu({ session, x, y }), []);
  const close = useCallback(() => setMenu(null), []);

  const run = useCallback(async () => {
    if (!confirm) return;
    const { kind, session } = confirm;
    try {
      if (kind === 'kill') await killSession(session.id);
      // A delete of a row whose process is already gone must not fail on the kill.
      else if (mayBeLive(session)) await killSession(session.id).catch(silentCatch('fleet/entry-e:delete-kill'));
      if (kind === 'delete') await removeSession(session.id);
    } catch (err) {
      toastCatch(`fleet/entry-e:${kind}`, kind === 'kill' ? 'Could not kill the session' : 'Could not delete the card')(err);
    } finally {
      setConfirm(null);
    }
  }, [confirm]);

  const items: ContextMenuItem[] = menu ? [
    ...(menu.session.state !== 'exited' ? [{
      id: 'terminal', label: 'Open terminal', icon: <SquareTerminal className="h-3.5 w-3.5" />,
      onSelect: () => onOpenTerminal(menu.session),
    }] : []),
    { id: 'recap', label: t.monitor.grid_session_recap_open, icon: <ScanEye className="h-3.5 w-3.5" />, onSelect: () => onOpenRecap(menu.session) },
    ...(mayBeLive(menu.session) ? [{
      id: 'kill', label: t.monitor.grid_fleet_kill, icon: <XOctagon className="h-3.5 w-3.5" />, separatorBefore: true,
      testId: 'entry-e-session-kill', onSelect: () => setConfirm({ kind: 'kill', session: menu.session }),
    }] : []),
    {
      id: 'delete', label: 'Delete card', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true,
      separatorBefore: !mayBeLive(menu.session), testId: 'entry-e-session-delete',
      onSelect: () => setConfirm({ kind: 'delete', session: menu.session }),
    },
  ] : [];

  const name = confirm ? sessionLabel(confirm.session) : '';
  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu && createPortal(
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={close} ariaLabel={sessionLabel(menu.session)} widthClass="w-52" />,
        document.body,
      )}
      {confirm?.kind === 'kill' && (
        <ConfirmDialog
          title={`${t.monitor.grid_fleet_kill}?`}
          body={`${name}: the process stops now. The card stays until you delete it.`}
          danger
          confirmLabel={t.monitor.grid_fleet_kill}
          onConfirm={run}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete this card?"
          body={`${name}: the session is stopped if it still runs, then removed from the board.`}
          danger
          confirmLabel="Delete card"
          onConfirm={run}
          onCancel={() => setConfirm(null)}
        />
      )}
    </MenuContext.Provider>
  );
}

/** Spread onto a session card's root: right-click, Shift+F10 and the Menu key. */
export function useSessionMenu(session: FleetSession) {
  const open = useContext(MenuContext);
  return useMemo(() => ({
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (!open) return;
      e.preventDefault();
      open(session, e.clientX, e.clientY);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!open || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      open(session, r.left + 12, r.top + r.height / 2);
    },
  }), [open, session]);
}

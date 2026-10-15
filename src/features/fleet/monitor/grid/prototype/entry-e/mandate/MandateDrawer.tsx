/* eslint-disable custom/enforce-base-modal --
 * A sheet in the Monitor's own drawer shell (`MonitorDrawerShell`, the same
 * one the persona and remote-session drawers use), not a centred modal: the
 * shell draws the backdrop and the spring. `role="dialog"` is what the
 * Monitor's Escape and the lane keys yield to; Escape is owned below. */
// The mandate drawer, in the Monitor's one drawer shell: the register (M), a
// mandate page, the act log across every mandate (L), and the orphanage (O:
// pending work no mandate holds, WP6; also opened by the Orphans lane button). Escape steps back
// one level (a page opened from the register or the log returns there), then
// closes. While it is up it owns the keyboard: nothing on the board behind it
// acts on a key.

import { BookOpen, Inbox, ScrollText, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { KitHost, Crumbs } from '@/features/shared/components/kit';
import { useLanesSnapshot } from '@/features/decision-center/lanes/useLanesSnapshot';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { MonitorDrawerShell } from '../../../../MonitorDrawerShell';
import { Kbd } from '../parts';
import { LedgerView } from './LedgerView';
import { MandatePage } from './MandatePage';
import { OrphanageView } from './orphans/OrphanageView';
import { RegisterView } from './RegisterView';
import { MANDATE_DRAWER_PRIORITY } from './useDrawerKeys';
import { useMandateDrawerRequest } from './mandateDrawerRequest';
import { useMandates } from './useMandates';

export type MandateView =
  | { kind: 'register' }
  /** `focusActId`: the act to select on arrival (the dock ticker's press). */
  | { kind: 'log'; focusActId?: string }
  | { kind: 'orphans' }
  | { kind: 'mandate'; charterId: string; back: 'register' | 'log' | null };

/**
 * The drawer's open state, owned by the Activity surface. A request from
 * outside it (`requestActLogAt`, the dock ticker) opens the act log at that act.
 */
export function useMandateDrawer() {
  const [view, setView] = useState<MandateView | null>(null);
  const pending = useMandateDrawerRequest((s) => s.pending);
  const orphans = useMandateDrawerRequest((s) => s.orphans);
  useEffect(() => {
    if (!pending) return;
    setView({ kind: 'log', focusActId: pending.actId });
    useMandateDrawerRequest.getState().consume();
  }, [pending]);
  useEffect(() => {
    if (orphans === null) return;
    setView({ kind: 'orphans' });
    useMandateDrawerRequest.getState().consumeOrphans();
  }, [orphans]);
  return {
    view,
    setView,
    openRegister: useCallback(() => setView({ kind: 'register' }), []),
    openLog: useCallback(() => setView({ kind: 'log' }), []),
    openMandate: useCallback((charterId: string) => setView({ kind: 'mandate', charterId, back: null }), []),
    close: useCallback(() => setView(null), []),
  };
}

export function MandateDrawer({ view, onView, onClose }: {
  view: MandateView | null;
  onView: (v: MandateView) => void;
  onClose: () => void;
}) {
  return (
    <MonitorDrawerShell open={view !== null} onClose={onClose} fill>
      {view && <DrawerBody view={view} onView={onView} onClose={onClose} />}
    </MonitorDrawerShell>
  );
}

function DrawerBody({ view, onView, onClose }: { view: MandateView; onView: (v: MandateView) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const mandates = useMandates();
  const { snapshot } = useLanesSnapshot(false);
  const [regSel, setRegSel] = useState(0);
  const current = view.kind === 'mandate' ? mandates.mandates?.find((x) => x.charterId === view.charterId) ?? null : null;
  const heldOf = useCallback(
    (charterId: string) => (snapshot ? snapshot.charters.find((c) => c.charterId === charterId)?.held ?? 0 : null),
    [snapshot],
  );
  const held = view.kind === 'mandate' ? heldOf(view.charterId) : null;

  const back = useCallback(() => {
    if (view.kind === 'mandate' && view.back) onView({ kind: view.back });
    else onClose();
  }, [view, onView, onClose]);
  const open = (from: 'register' | 'log') => (charterId: string) => onView({ kind: 'mandate', charterId, back: from });

  useAppKeyboard((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      back();
      return true;
    }
    if (k === 'm' || k === 'M') { onView({ kind: 'register' }); e.preventDefault(); return true; }
    if (k === 'l' || k === 'L') { onView({ kind: 'log' }); e.preventDefault(); return true; }
    if (k === 'o' || k === 'O') { onView({ kind: 'orphans' }); e.preventDefault(); return true; }
    return false;
  }, { priority: MANDATE_DRAWER_PRIORITY, exclusive: true });

  const trail = [
    { label: m.ml_register, onPress: view.kind === 'register' ? undefined : () => onView({ kind: 'register' }) },
    ...(view.kind === 'log' ? [{ label: m.ml_act_log }] : []),
    ...(view.kind === 'orphans' ? [{ label: m.ml_orphanage }] : []),
    ...(view.kind === 'mandate' ? [{ label: current?.projectName ?? m.ml_mandate }] : []),
  ];

  return (
    <div
      role="dialog"
      aria-label={m.ml_drawer_aria}
      // A flex chain down to the content, every link able to shrink: the shell
      // spans the Monitor's height (`fill`), and on a short window the content
      // must give way to it instead of running under the drawer's bottom edge,
      // where the last rows and a picked scope were cut off.
      className="ml-sheet flex min-h-0 flex-1 flex-col p-4 [&>.k-host]:flex [&>.k-host]:min-h-0 [&>.k-host]:flex-1 [&>.k-host]:flex-col"
      data-testid="mandate-drawer"
      data-view={view.kind}
    >
      <KitHost>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
        <header className="flex items-center gap-2">
          <Crumbs items={trail} label={m.ml_drawer_aria} testId="mandate-drawer-crumbs" />
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => onView({ kind: 'register' })} icon={<BookOpen className="h-3.5 w-3.5" aria-hidden />} aria-keyshortcuts="M" data-testid="mandate-drawer-register">
              {m.ml_register} <Kbd>M</Kbd>
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onView({ kind: 'log' })} icon={<ScrollText className="h-3.5 w-3.5" aria-hidden />} aria-keyshortcuts="L" data-testid="mandate-drawer-log">
              {m.ml_act_log} <Kbd>L</Kbd>
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onView({ kind: 'orphans' })} icon={<Inbox className="h-3.5 w-3.5" aria-hidden />} aria-keyshortcuts="O" data-testid="mandate-drawer-orphans">
              {m.ml_orphanage} <Kbd>O</Kbd>
            </Button>
            <Button variant="ghost" size="xs" onClick={back} icon={<X className="h-3.5 w-3.5" aria-hidden />} aria-keyshortcuts="Escape" data-testid="mandate-drawer-close">
              {view.kind === 'mandate' && view.back ? m.ml_back : t.common.close} <Kbd>Esc</Kbd>
            </Button>
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {view.kind === 'register' && <RegisterView state={mandates} selected={regSel} onSelect={setRegSel} onOpen={open('register')} heldOf={heldOf} onOpenLog={(focusActId) => onView({ kind: 'log', focusActId })} />}
          {view.kind === 'log' && (
            <LedgerView key={view.focusActId ?? ''} mandates={mandates.mandates} focusActId={view.focusActId ?? null} onOpen={open('log')} />
          )}
          {view.kind === 'orphans' && <OrphanageView mandates={mandates.mandates} />}
          {view.kind === 'mandate' && (current ? (
            <MandatePage key={current.charterId} mandate={current} held={held} onChanged={mandates.refresh} />
          ) : (
            <p className="typo-body" role="status">{mandates.mandates === null ? m.ml_loading : m.ml_mandate_gone}</p>
          ))}
        </div>
        </div>
      </KitHost>
    </div>
  );
}

// The ledger's keyboard while the page is up: a handler ONE rung above the sheet's (LEDGER_PRIORITY), not exclusive,
// so the keys it leaves (L, Q, ?, and Esc once its own layers are closed) fall to the sheet's handler and its Esc
// ladder (overlay, selection, then the page itself). It reads model/ledgerKeys.ts, which reads the sheet's one keymap,
// so no key is bound twice. A note prompt or the key sheet on top, or typing in a field, leaves every key alone.
import { useRef } from 'react';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useSheet } from '../controller/SheetContext';
import { BLUEPRINT_PRIORITY } from '../controller/useSheetKeys';
import { LEDGER_TABS } from '../model/ledger';
import { ledgerAct } from '../model/ledgerKeys';
import { COMPARE_MODES, cycle, setLedger, setTab } from './ledgerStore';
import type { Ledger } from './useLedger';
import type { LedgerActs } from './useLedgerActs';

/** One rung above the sheet's own handler: the ledger sees a key first while it is up. */
export const LEDGER_PRIORITY = BLUEPRINT_PRIORITY + 1;

const isField = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function useLedgerKeys(L: Ledger, acts: LedgerActs, filter: React.RefObject<HTMLInputElement | null>): void {
  const s = useSheet();
  const ref = useRef({ L, acts, overlay: s.ui.overlay });
  ref.current = { L, acts, overlay: s.ui.overlay };
  // a control owns Enter and Space only for a person who TABBED to it; focus a click left on a chip or a tab must not
  // eat the keymap's Space (the sheet's own handler holds the same rule)
  const tabbed = useRef(false);
  useAppKeyboard((e) => {
    if (e.key === 'Tab') tabbed.current = true; else if (e.key !== 'Enter' && e.key !== ' ') tabbed.current = false;
    const { L: l, acts: a, overlay } = ref.current;
    if (overlay || e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return false;
    const act = ledgerAct(e.key);
    if (!act || act === 'pass') return false;
    if ((act === 'open' || act === 'select') && tabbed.current && e.target instanceof HTMLButtonElement) return false;
    const cmp = l.ui.scope === 'packs' && l.ui.tab !== 'release' && !!l.ui.open;
    switch (act) {
      case 'back':
        if (cmp && l.ui.wide) setLedger((u) => ({ ...u, wide: false }));
        else if (cmp) setLedger((u) => ({ ...u, open: null, wide: false }));
        else return false;
        break;
      case 'next': a.step(1); break;
      case 'prev': a.step(-1); break;
      case 'select': a.checkCurrent(); break;
      case 'open': a.enter(); break;
      case 'filter': filter.current?.focus(); break;
      case 'tab1': case 'tab2': case 'tab3': setTab(LEDGER_TABS[Number(act.slice(3)) - 1] ?? 'triage'); break;
      case 'accept': case 'rework': case 'descope': case 'reopen': if (l.ui.scope === 'packs') a.triage(act); break;
      case 'approve': if (l.ui.scope === 'backlog') a.approve(); break;
      case 'decline': if (l.ui.scope === 'backlog') a.decline(); break;
      case 'wide': if (cmp) setLedger((u) => ({ ...u, wide: !u.wide })); break;
      case 'mode': if (cmp) setLedger((u) => ({ ...u, cmp: { ...u.cmp, mode: cycle(COMPARE_MODES, u.cmp.mode) } })); break;
      case 'swallow': break;
    }
    e.preventDefault();
    return true;
  }, { priority: LEDGER_PRIORITY });
}

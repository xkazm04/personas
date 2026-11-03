// The sheet's keyboard: ONE handler over the ONE keymap (model/keymap.ts). It registers above the Decision Deck
// (priority 85) and is exclusive, so a key the sheet does not name never reaches the deck behind it, and Esc climbs
// (overlay, armed build, rail flyout, selection, compare panel, L4 sheet, timeline panel, time travel, the ledger
// page, then level by level) and only at the site closes the sheet: one press
// never closes two layers. Y, R, S and U triage the current item (WP4b) wherever it is: the store answers. Typing in a field is left alone; the field's own React handler owns Enter, Esc and the arrows.
import { useRef } from 'react';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { actOf, lensIndexOfKey } from '../model/keymap';
import type { Plan } from '../model/plan';
import type { WorkItem } from '../model/work';
import type { UiAction, UiState } from '../state/uiState';
import type { Nav } from './useNavigation';
import type { Writes } from './useWrites';
import type { Dispatch } from 'react';

/** Above the Decision Deck's Esc (DECK_PRIORITY 85) and below the command palette (90). */
export const BLUEPRINT_PRIORITY = 88;

interface Deps {
  plan: Plan;
  ui: UiState;
  dispatch: Dispatch<UiAction>;
  /** The camera's level right now (0..3), read from the camera itself, never from a snapshot of the last frame. */
  levelNow: () => number;
  nav: Nav;
  writes: Writes;
  current: WorkItem | null;
  onClose: () => void;
  /** Enter on an open L4 sheet: take the current item's recommended answer (D14); false when it has none. */
  takeRecommended: () => boolean;
  sayEnterHint: () => void;
}

const MODIFIERS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
const isField = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useSheetKeys(d: Deps): void {
  const ref = useRef(d);
  ref.current = d;
  // A focused button owns Enter only for a person who TABBED to it. Focus left on a control by a click or by the modal's
  // own focusing must not eat the keymap's Enter (it once re-activated the L0 button and undid every descent).
  const tabbed = useRef(false);
  useAppKeyboard((e) => {
    if (e.key === 'Tab') tabbed.current = true; else if (e.key !== 'Enter' && e.key !== ' ') tabbed.current = false;
    return handle(ref.current, e, tabbed.current);
  }, { priority: BLUEPRINT_PRIORITY, exclusive: true });
}

/** Tab stays inside the topmost modal (the sheet itself, or the dialog it opened): the handler is exclusive, so BaseModal's own trap, one rung below, never sees the key. */
function trapTab(e: KeyboardEvent): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const top = dialogs[dialogs.length - 1];
  const list = top ? Array.from(top.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
  if (!list.length) return false;
  const first = list[0]!, last = list[list.length - 1]!, at = document.activeElement;
  if (e.shiftKey && (at === first || !top!.contains(at))) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && (at === last || !top!.contains(at))) { e.preventDefault(); first.focus(); return true; }
  return false;
}

function back(d: Deps): void {
  if (d.ui.overlay) { d.dispatch({ type: 'overlay', overlay: null }); return; }
  if (d.ui.armed) { d.writes.disarm(); return; }
  if (d.ui.flyout) { d.dispatch({ type: 'flyout', id: null }); return; }
  if (d.ui.selected.length) { d.dispatch({ type: 'selectClear' }); return; }
  if (d.ui.compare) { d.nav.compare(null); return; }
  if (d.ui.sheet) { d.nav.closeSheet(); return; }
  if (d.ui.timelineOpen) { d.dispatch({ type: 'timeline', open: false }); return; }
  if (d.ui.asOf) { d.dispatch({ type: 'asOf', date: null }); return; }
  if (d.ui.page === 'ledger') { d.dispatch({ type: 'page', page: 'plan' }); return; }
  const n = d.levelNow();
  if (n > 0) { d.nav.toLevel(n - 1); return; }
  d.onClose();
}

function handle(d: Deps, e: KeyboardEvent, tabbed: boolean): boolean {
  if (e.key === 'Tab') return trapTab(e);
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  // the key sheet closes on ANY key (a bare modifier is not one)
  if (d.ui.overlay?.kind === 'help' && !MODIFIERS.has(e.key)) { e.preventDefault(); d.dispatch({ type: 'overlay', overlay: null }); return true; }
  if (isField(e.target)) return false;
  const act = actOf(e.key);
  if (!act) return false;
  if (tabbed && e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return false;
  e.preventDefault();
  const { ui, nav, writes, plan, dispatch } = d;
  if (ui.overlay?.kind === 'help') { dispatch({ type: 'overlay', overlay: null }); return true; }
  if (ui.overlay) { if (act === 'back') back(d); return true; }
  if (ui.armed) {
    if (act === 'build' || act === 'enter') { void writes.confirm(); return true; }
    if (act === 'back') { writes.disarm(); return true; }
    dispatch({ type: 'arm', ids: null });
  }
  switch (act) {
    case 'help': dispatch({ type: 'overlay', overlay: { kind: 'help' } }); break;
    case 'find': dispatch({ type: 'overlay', overlay: { kind: 'find' } }); break;
    case 'queue': dispatch({ type: 'queue' }); break;
    case 'next': nav.step(1); break;
    case 'prev': nav.step(-1); break;
    case 'approve': void writes.approve(d.current); break;
    case 'decline': writes.askDecline(d.current); break;
    case 'build': writes.arm(); break;
    case 'accept': case 'rework': case 'descope': case 'reopen': writes.askTriage(d.current, act); break;
    case 'wingNext': nav.wing(1); break;
    case 'wingPrev': nav.wing(-1); break;
    case 'site': nav.toLevel(0); break;
    case 'zoomOut': nav.zoom(1 / 1.35); break;
    case 'zoomIn': nav.zoom(1.35); break;
    case 'back': back(d); break;
    case 'ledger': dispatch({ type: 'page' }); break;
    case 'timeline': dispatch({ type: 'timeline' }); break;
    case 'select': if (d.current) dispatch({ type: 'select', id: d.current.id }); break;
    case 'enter': {
      // on the L4 sheet, Enter takes the current item's recommended answer (owner decision D14), else says the keys
      if (ui.sheet) { if (!d.takeRecommended()) d.sayEnterHint(); break; }
      const n = d.levelNow();
      nav.toLevel(n >= 3 ? 4 : n + 1);
      break;
    }
    case 'lens': {
      const i = lensIndexOfKey(e.key);
      const id = i === null ? undefined : i === 0 ? 'general' : plan.lenses[i - 1]?.id;
      if (id) { dispatch({ type: 'lens', id }); if (ui.sheet) dispatch({ type: 'sheetLens', id }); }
      break;
    }
  }
  return true;
}

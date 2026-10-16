// The findings ledger's keys, read from the sheet's ONE keymap (keymap.ts) wherever bp's ledger keys collide with it:
// bp accepts with A, here Y (A is approve); bp selects with X too, here Space only (X is decline); bp's L cycles the
// compare theme, here L is the page switch, so the theme has no key (its segmented control stays). Two keys the keymap
// does not bind are the ledger's own while it is up: W (the compare panel full width) and M (cycle the compare mode).
// 1, 2 and 3 switch the ledger's tabs while it is up (they name lens sheets on the plan); the other digits, the wing
// arrows, zoom, site and build act on the plan behind the page, so the ledger swallows them.
import { actOf, type KeyAct } from './keymap';

export type LedgerAct =
  | 'next' | 'prev' | 'select' | 'open' | 'filter'
  | 'accept' | 'rework' | 'descope' | 'reopen' | 'approve' | 'decline'
  | 'tab1' | 'tab2' | 'tab3' | 'wide' | 'mode' | 'back'
  /** Handled by the sheet's own handler under the page (L, Q, ?). */
  | 'pass'
  /** A plan key with nothing to do on the ledger: consumed so the hidden plan stays still. */
  | 'swallow';

/** The ledger's own keys: unbound in keymap.ts (a test holds it to that). */
export const LEDGER_OWN: Readonly<Record<string, LedgerAct>> = { w: 'wide', m: 'mode' };

const FROM_KEYMAP: Partial<Record<KeyAct, LedgerAct>> = {
  next: 'next', prev: 'prev', select: 'select', enter: 'open', find: 'filter',
  accept: 'accept', rework: 'rework', descope: 'descope', reopen: 'reopen', approve: 'approve', decline: 'decline',
  back: 'back', ledger: 'pass', queue: 'pass', help: 'pass',
  wingNext: 'swallow', wingPrev: 'swallow', site: 'swallow', zoomIn: 'swallow', zoomOut: 'swallow', build: 'swallow', timeline: 'swallow',
};

/** What a key does while the ledger is up; null for a key no one binds. */
export function ledgerAct(key: string): LedgerAct | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const own = LEDGER_OWN[k];
  if (own) return own;
  const act = actOf(key);
  if (!act) return null;
  if (act === 'lens') return k === '1' ? 'tab1' : k === '2' ? 'tab2' : k === '3' ? 'tab3' : 'swallow';
  return FROM_KEYMAP[act] ?? null;
}

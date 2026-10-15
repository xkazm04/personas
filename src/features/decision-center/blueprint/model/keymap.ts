// The ONE keymap. A key sheet, the key hints and the sheet's handler all read this table; a key is bound once.
// Plain keys only (no Ctrl/Meta/Alt). `a`, `x` and `b` are the Build queue's three verbs: approve (never builds),
// decline (asks why), build (arms, then confirms). Triage keys for built items are WP4b's and are not bound here.

export type KeyAct =
  | 'next' | 'prev' | 'find' | 'queue'
  | 'approve' | 'decline' | 'build'
  | 'enter' | 'back' | 'wingNext' | 'wingPrev' | 'site' | 'zoomOut' | 'zoomIn'
  | 'lens' | 'help';
export type KeyGroup = 'walk' | 'decide' | 'move' | 'sheets';

export interface Binding { act: KeyAct; group: KeyGroup; keys: readonly string[] }

export const KEYMAP: readonly Binding[] = [
  { act: 'next', group: 'walk', keys: ['j', 'ArrowDown'] },
  { act: 'prev', group: 'walk', keys: ['k', 'ArrowUp'] },
  { act: 'find', group: 'walk', keys: ['/'] },
  { act: 'queue', group: 'walk', keys: ['q'] },
  { act: 'approve', group: 'decide', keys: ['a'] },
  { act: 'decline', group: 'decide', keys: ['x'] },
  { act: 'build', group: 'decide', keys: ['b'] },
  { act: 'enter', group: 'move', keys: ['Enter'] },
  { act: 'back', group: 'move', keys: ['Escape', 'Backspace'] },
  { act: 'wingNext', group: 'move', keys: ['l', 'ArrowRight'] },
  { act: 'wingPrev', group: 'move', keys: ['h', 'ArrowLeft'] },
  { act: 'site', group: 'move', keys: ['0'] },
  { act: 'zoomOut', group: 'move', keys: ['-'] },
  { act: 'zoomIn', group: 'move', keys: ['=', '+'] },
  { act: 'lens', group: 'sheets', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] },
  { act: 'help', group: 'sheets', keys: ['?'] },
];

const BY_KEY: ReadonlyMap<string, KeyAct> = new Map(KEYMAP.flatMap((b) => b.keys.map((k): [string, KeyAct] => [k, b.act])));

/** The action a key event names, or undefined. `e.key` is normalised: single letters fold to lower case. */
export function actOf(key: string): KeyAct | undefined {
  return BY_KEY.get(key.length === 1 ? key.toLowerCase() : key);
}

/** The keys an action is bound to, as the keymap says (the hints read this, never a literal). */
export const keysFor = (act: KeyAct): readonly string[] => KEYMAP.find((b) => b.act === act)?.keys ?? [];

/** The lens sheet a digit names: 1 = General, 2..9 = the n-th lens of the registry. */
export function lensIndexOfKey(key: string): number | null {
  return /^[1-9]$/.test(key) ? Number(key) - 1 : null;
}

/** How a key prints on a keycap. */
export const KEYCAP: Readonly<Record<string, string>> = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backspace: 'Bksp', Enter: 'Enter' };
export const capOf = (key: string): string => KEYCAP[key] ?? key.toUpperCase();

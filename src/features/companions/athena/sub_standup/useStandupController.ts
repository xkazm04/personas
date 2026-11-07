import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { StandupSource } from './data/types';
import { openAthenaChat } from './data/openAthenaChat';
import { clampSel, nextOpen, reduceKey, type Intent, type UiState } from './model/keymap';
import { pickPatch, statePatch, typedPatch } from './model/patch';
import type { RowView, StandupView } from './model/types';

/** Between the cheat sheet (20) and `;` nav mode (30) on the AppKeyboardProvider ladder. */
const STANDUP_KEY_PRIORITY = 25;

/** Keys the page owns only when focus is on no editable control. */
function fromEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The page's UI state (selection, decision modal, dossier, sheets, zoom) and the B/1 keymap:
 * one registration on the app keyboard ladder routed through the pure
 * `reduceKey`, never from an input, never with a modifier held, and each
 * intent run through the source.
 */
export function useStandupController(view: StandupView, source: StandupSource, ui: UiState, setUi: Dispatch<SetStateAction<UiState>>) {
  const { actions } = source;

  const run = useCallback((intent: Intent) => {
    const patch = intent.type === 'pick' ? pickPatch(intent.row, intent.index)
      : intent.type === 'skip' ? statePatch(intent.row, 'skipped')
      : intent.type === 'accept' ? statePatch(intent.row, 'accepted')
      : intent.type === 'undo' ? statePatch(intent.row, 'proposed')
      : null;
    if (patch) { void actions.patch(patch); return; }
    if (intent.type === 'arm') void actions.arm();
    else if (intent.type === 'amend') void actions.open();
    else if (intent.type === 'talk' && intent.row.itemId) {
      // The chat opens on its own layer: the decision modal steps aside for it.
      setUi((u) => ({ ...u, decide: false }));
      void actions.discuss(intent.row.itemId).then((id) => { if (id) openAthenaChat(id); });
    }
  }, [actions, setUi]);

  // The page's keymap sits on the app's keyboard ladder (focus-management): above the app cheat
  // sheet (20) so "?" opens THIS page's legend while the standup is up, below `;` nav mode (30)
  // and every overlay (BaseModal 80 keeps its Escape and focus trap).
  useAppKeyboard((e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || fromEditable(e.target)) return false;
    const { ui: next, intent } = reduceKey(ui, e.key, view);
    const changed = (Object.keys(next) as Array<keyof UiState>).some((k) => next[k] !== ui[k]);
    if (!changed && !intent) return false;
    e.preventDefault();
    if (changed) setUi(next);
    if (intent) run(intent);
    return true;
  }, { priority: STANDUP_KEY_PRIORITY });

  // A shrinking row list (a refresh, a new revision) never leaves the cursor past the end.
  const sel = view.rows.length ? clampSel(ui.sel, view) : 0;

  const select = useCallback((index: number) => setUi((u) => (u.sel === index ? u : { ...u, sel: index, typing: null })), [setUi]);
  // A pointer or Enter pick advances like the number keys do: the modal walks on to the next open card.
  const pick = useCallback((row: RowView, index: number) => {
    if (view.life !== 'decide') return;
    run({ type: 'pick', row, index });
    setUi((u) => ({ ...u, sel: nextOpen(view, u.sel), typing: null }));
  }, [run, view, setUi]);
  const typed = useCallback((row: RowView, text: string | null) => {
    setUi((u) => ({ ...u, typing: null }));
    const patch = text === null ? null : typedPatch(row, text);
    if (patch) void actions.patch(patch);
  }, [actions, setUi]);
  const set = useCallback((next: Partial<UiState>) => setUi((u) => ({ ...u, ...next })), [setUi]);

  return { ui: { ...ui, sel }, set, select, pick, typed, arm: actions.arm, amend: actions.open, end: actions.end };
}

// The ledger's keymap, as a pure function: (layer, key) → command.
//
// The shell's one handler runs through the app keyboard ladder
// (`useAppKeyboard`); this file only decides what a key MEANS, so the keymap
// is testable without a DOM. Text inputs, modifiers and dialogs are filtered
// by `shouldIgnoreKey` before a key ever reaches here.
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';

export type LedgerLayer = 'ledger' | 'review' | 'gains';

export type LedgerCommand =
  | { kind: 'move'; by: 1 | -1 }
  | { kind: 'toggle-row' }
  | { kind: 'back' }
  | { kind: 'open-review' }
  | { kind: 'new-contest' }
  | { kind: 'toggle-gains' }
  | { kind: 'bucket'; bucket: ContestReviewBucket | null }
  | { kind: 'pin-mode' };

/** Number keys → trays, in the order the skill's review file lists them. */
export const BUCKET_KEYS: Readonly<Record<string, ContestReviewBucket | null>> = {
  '1': 'failure',
  '2': 'impractical',
  '3': 'shortlist',
  '4': 'winner',
  '0': null,
};

export function resolveLedgerKey(layer: LedgerLayer, key: string): LedgerCommand | null {
  if (key === 'j' || key === 'ArrowDown') return { kind: 'move', by: 1 };
  if (key === 'k' || key === 'ArrowUp') return { kind: 'move', by: -1 };
  if (key === 'Escape') return { kind: 'back' };

  if (layer === 'review') {
    if (key in BUCKET_KEYS) return { kind: 'bucket', bucket: BUCKET_KEYS[key] ?? null };
    if (key === 'p') return { kind: 'pin-mode' };
    return null;
  }

  if (key === 'n') return { kind: 'new-contest' };
  if (key === 'g') return { kind: 'toggle-gains' };
  if (layer === 'ledger') {
    if (key === 'Enter') return { kind: 'toggle-row' };
    if (key === 'r') return { kind: 'open-review' };
  }
  return null;
}

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/**
 * A key the ledger must leave alone: a modifier chord (app shortcuts), a key
 * typed into a text field (the brief, a note, a pin), anything inside an open
 * dialog (ConfirmDialog, the setup palette), or a key an activator on focus
 * owns (Enter on a focused button activates THAT button).
 */
export function shouldIgnoreKey(e: KeyLike): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (el.closest('[role="dialog"],[aria-modal="true"],[role="listbox"],[role="combobox"]')) return true;
  if (e.key === 'Enter' && el.closest('button,a[href],[role="button"],[role="tab"]')) return true;
  return false;
}

/** Cursor arithmetic that clamps (a ledger does not wrap). */
export function moveCursor(index: number, by: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + by));
}

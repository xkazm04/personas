import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

/** True when a bare key belongs to the page, not to a field or an open popover. */
export function isFreeKey(e: KeyboardEvent): boolean {
  // A held modifier means the key belongs to a shortcut — Ctrl/Cmd+1..9 is
  // "switch tab" everywhere, and answering Athena instead is both surprising and
  // unrecoverable (the answer is sent immediately). Autorepeat likewise: one
  // keypress, one answer.
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
  // …and not while a popover is open over the preview. Studio's popovers — the
  // tab picker, the build-settings panel, the version-history menu — are all
  // opened from a trigger that declares `aria-haspopup` and flips
  // `aria-expanded`, so one query answers "is the user looking at something
  // else". Without this, reading the version list and typing a digit sent an
  // irreversible answer to Athena: none of those surfaces is a text field.
  if (document.querySelector('[aria-haspopup][aria-expanded="true"]')) return false;
  return true;
}

// 1-N answers Athena's question from the keyboard, shared by both Studio
// layouts' question cards, registered on the app keyboard ladder at the
// route-decision rung. `enabled` lets a hidden card stop listening.
export function useDecisionKeys(options: string[], onAnswer: (answer: string) => void, enabled = true) {
  useAppKeyboard(
    (e) => {
      if (!isFreeKey(e)) return false;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > options.length) return false;
      const opt = options[n - 1];
      if (opt === undefined) return false;
      e.preventDefault();
      onAnswer(opt);
      return true;
    },
    { enabled: enabled && options.length > 0, priority: ROUTE_DECISION_PRIORITY },
  );
}

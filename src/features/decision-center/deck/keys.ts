/** Keyboard helpers shared by the peek and the deck. */

/** Priority rung: above a full-screen layer (60), below BaseModal (80). */
export const PEEK_PRIORITY = 70;
/** Above BaseModal so an armed verdict / open reason prompt takes Escape first. */
export const DECK_PRIORITY = 85;

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Bare key, no modifier (Shift allowed only where the caller asks for it). */
export function plain(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** `1`..`9` from either row of the keyboard, by physical key (Shift-safe). */
export function digitOf(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) : null;
}

/** The composer of THIS card — two cards coexist mid-slide, so never a global id. */
export function focusComposer(itemId: string): void {
  document.querySelector<HTMLTextAreaElement>(`[data-deck-composer="${CSS.escape(itemId)}"]`)?.focus();
}

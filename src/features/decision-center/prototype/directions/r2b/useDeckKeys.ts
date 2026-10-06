/**
 * The deck's keyboard grammar (decided; implemented exactly):
 *   ←/→ (also K/J) walk · ↑/↓ scroll the body · A accept · R reject (arm;
 *   Enter or R confirms; a reason may follow) · S skip · D done (reports,
 *   chat) · Space focus the composer · 1-9 branches (or reason options while
 *   a prompt is open) · Shift+1-5 rate a report · ? toggles the key map ·
 *   Esc steps back (closing the key map first).
 *
 * Escape is BaseModal's (one owner, any keyboard provider or none): its
 * onClose first asks the deck to disarm an armed verdict or close a reason
 * prompt, and only a press with nothing to undo steps the hub back to the peek.
 * Letters never fire while the composer or a reason field has focus.
 */
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { DECK_PRIORITY, digitOf, focusComposer, isTypingTarget, plain } from './keys';

const SCROLL_STEP = 120;

export function useDeckKeys(deck: DeckController, act: DeckActions, opts: { enabled: boolean; onRate: (n: number) => void; onKeys: () => void }) {
  useAppKeyboard((e) => {
    // Escape belongs to BaseModal (80); its onClose asks the deck to disarm first (DeckModal escapeGuard).
    if (e.key === 'Escape') return false;
    if (isTypingTarget(e.target) || !plain(e) || !deck.item) return false;
    if (e.key === '?') { opts.onKeys(); e.preventDefault(); return true; }
    const digit = digitOf(e);

    if (deck.prompt) {
      if (digit && !e.shiftKey) {
        const o = deck.prompt.options[digit - 1];
        if (o) { act.submitReason(o.value); e.preventDefault(); return true; }
        return false;
      }
      if (e.key === 'Enter' && deck.item.kind !== 'council') { act.submitReason(undefined); e.preventDefault(); return true; }
      return false;
    }

    if (digit) {
      if (e.shiftKey) {
        if (act.type !== 'report' || digit > 5) return false;
        opts.onRate(digit);
      } else if (!act.branch(digit)) return false;
      e.preventDefault();
      return true;
    }
    if (e.shiftKey && e.key !== 'Enter') return false;

    const scroller = () => document.querySelector<HTMLElement>(`[data-r2b-scroll="${CSS.escape(deck.item!.id)}"]`);
    switch (e.key) {
      case 'ArrowRight': case 'j': case 'J': deck.walk(1); break;
      case 'ArrowLeft': case 'k': case 'K': deck.walk(-1); break;
      case 'ArrowDown': scroller()?.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' }); break;
      case 'ArrowUp': scroller()?.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' }); break;
      case 'a': case 'A': act.accept(); break;
      case 'r': case 'R': act.reject(); break;
      case 's': case 'S': act.skip(); break;
      case 'd': case 'D':
        if (act.type !== 'report' && act.type !== 'chat') return false;
        if (deck.item.kind === 'council') return false;
        act.done();
        break;
      case ' ':
        if (act.type !== 'chat') return false;
        focusComposer(deck.item.id);
        break;
      case 'Enter':
        if (!act.confirm()) return false;
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  }, { enabled: opts.enabled, priority: DECK_PRIORITY });
}

import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { digitOf, isTypingTarget, plain } from '@/features/decision-center/deck/keys';
import type { NeedsYou } from './useNeedsYou';

/** True while a dialog is up over the Monitor (the deck, a detail modal): its keys, not ours. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

/**
 * The rail's keys, on the route rung of the app's ladder (below every overlay):
 * A accept, R reject, S later, J / K walk, 1-9 a branch, and while the answer or
 * reason field is up, a digit picks an option. Letters never fire while the
 * composer or any field has focus, so typing in the thread is never a verdict.
 */
export function useNeedsYouKeys(ny: NeedsYou, enabled: boolean) {
  useAppKeyboard((e) => {
    if (isTypingTarget(e.target) || !plain(e) || e.shiftKey || !ny.ask || dialogOpen()) return false;
    const digit = digitOf(e);
    if (ny.prompt) {
      const option = digit ? ny.prompt.options[digit - 1] : undefined;
      if (!option) return false;
      ny.submitPrompt(option.value);
      e.preventDefault();
      return true;
    }
    if (digit) {
      if (!ny.branch(digit)) return false;
      e.preventDefault();
      return true;
    }
    switch (e.key) {
      case 'a': case 'A': ny.accept(); break;
      case 'r': case 'R': ny.reject(); break;
      case 's': case 'S': ny.skip(); break;
      case 'j': case 'J': ny.walk(1); break;
      case 'k': case 'K': ny.walk(-1); break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }, { enabled, priority: ROUTE_DECISION_PRIORITY });
}

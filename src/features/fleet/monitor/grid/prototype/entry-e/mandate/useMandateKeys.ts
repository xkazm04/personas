// The Activity surface's mandate keys: `M` opens the
// register, `L` the act log. Route rung, like the board's own cursor, so any
// overlay above the board (a peek, the deck, a modal) takes the key first;
// and inert while any dialog is up.

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/features/decision-center/deck/keys';

export function useMandateKeys(enabled: boolean, doors: { openRegister: () => void; openLog: () => void }): void {
  useAppKeyboard((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTypingTarget(e.target)) return false;
    if (document.querySelector('[role="dialog"]')) return false;
    if (e.key === 'm' || e.key === 'M') doors.openRegister();
    else if (e.key === 'l' || e.key === 'L') doors.openLog();
    else return false;
    e.preventDefault();
    return true;
  }, { enabled, priority: ROUTE_DECISION_PRIORITY });
}

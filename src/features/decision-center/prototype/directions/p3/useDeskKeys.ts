/**
 * The desk's keyboard grammar (decided, implemented exactly):
 * ←/→ (J/K) walk · ↑/↓ scroll · A accept · R reject (arm; Enter confirms; a
 * reason prompt may follow) · S skip · D done · Space composer · 1-9 branches ·
 * Esc steps back. Reports add ⇧1-5 for the rating.
 *
 * Priority 85 — one rung above BaseModal (80). Escape is NOT handled here (only
 * a focused field is blurred): BaseModal's onClose is the desk's one step-back
 * (armed/reason -> desk -> peek), so the ladder lives in a single place.
 */
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from './model';
import type { DeskCtl } from './useDesk';

/** One rung above BaseModal's own dismiss handler, so desk verdict keys are seen first. */
export const DESK_KEY_PRIORITY = OVERLAY_DISMISS_PRIORITY + 5;

function digitOf(e: KeyboardEvent): number | null {
  const m = /^Digit([0-9])$/.exec(e.code) ?? /^Numpad([0-9])$/.exec(e.code);
  return m ? Number(m[1]) : null;
}

export function useDeskKeys(ctl: DeskCtl, enabled: boolean) {
  useAppKeyboard((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (isTypingTarget(e.target)) {
      if (e.key !== 'Escape') return false;
      // Leave the field; the next Escape is BaseModal's step-back.
      (e.target as HTMLElement).blur();
      return true;
    }
    const digit = digitOf(e);
    if (ctl.reasonOpen) {
      if (digit === 0) { ctl.skipReason(); return true; }
      if (digit !== null) { ctl.pickReason(digit - 1); return true; }
      if (e.key === 'Enter') { ctl.submitReason(); return true; }
      return false;
    }
    const k = e.key.toLowerCase();
    switch (true) {
      case e.key === 'ArrowRight' || k === 'j': ctl.walk(1); return true;
      case e.key === 'ArrowLeft' || k === 'k': ctl.walk(-1); return true;
      case e.key === 'ArrowDown': ctl.bodyRef.current?.scrollBy({ top: 96 }); return true;
      case e.key === 'ArrowUp': ctl.bodyRef.current?.scrollBy({ top: -96 }); return true;
      case e.key === 'Enter':
        if (!ctl.armed) return false;
        ctl.confirm();
        return true;
      case k === 'a': ctl.accept(); return true;
      case k === 'r': ctl.reject(); return true;
      case k === 's': ctl.skip(); return true;
      case k === 'd': ctl.done(); return true;
      case e.key === ' ':
        if (ctl.type !== 'chat') return false;
        e.preventDefault();
        ctl.composerRef.current?.focus();
        return true;
      case digit !== null && digit > 0:
        if (e.shiftKey && ctl.item?.kind === 'report') {
          if (digit! <= 5) ctl.setRating(digit!);
          return true;
        }
        ctl.branch(digit! - 1);
        return true;
      default:
        return false;
    }
  }, { enabled, priority: DESK_KEY_PRIORITY });
}

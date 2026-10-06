/**
 * The modal's keyboard grammar (decided, implemented exactly):
 *   ←/→ (K/J) walk · ↑/↓ scroll · A accept · R reject (arm) · Enter confirm ·
 *   S skip · D done · Space composer · 1-9 branches (or reason options) ·
 *   ⇧1-5 rate a report · Esc steps back.
 *
 * Rank: OVERLAY_DISMISS_PRIORITY, BaseModal's own rung — this IS the modal's
 * keyboard. Esc is deliberately NOT handled here: BaseModal owns it and calls
 * the sheet's close request, which steps back one level (leave the field ->
 * disarm -> close). While typing, every key is the field's.
 */
import type { RefObject } from 'react';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from './meta';
import type { SheetFlow } from './useSheetFlow';

const SCROLL_STEP = 96;

export function useSheetKeys({
  enabled, flow, scrollRef, onWalk, focusComposer, isReport,
}: {
  enabled: boolean;
  flow: SheetFlow;
  scrollRef: RefObject<HTMLElement | null>;
  onWalk: (delta: 1 | -1) => void;
  focusComposer: () => void;
  isReport: boolean;
}) {
  useAppKeyboard((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (isTypingTarget(e.target) || e.key === 'Escape') return false;

    // ⇧1-5 rates a report (digits alone are branches).
    if (e.shiftKey && isReport && /^Digit[1-5]$/.test(e.code)) {
      flow.setRating(Number(e.code.slice(5)));
      return true;
    }
    if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      return flow.reasonOpen ? flow.pickReason(i) : flow.branch(i);
    }

    switch (e.key) {
      case 'ArrowRight': case 'j': case 'J': onWalk(1); return true;
      case 'ArrowLeft': case 'k': case 'K': onWalk(-1); return true;
      case 'ArrowDown':
        scrollRef.current?.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
        return true;
      case 'ArrowUp':
        scrollRef.current?.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
        return true;
      case 'Enter':
        if (!flow.armed && !flow.reasonOpen) return false; // a focused button keeps Enter
        e.preventDefault();
        flow.confirm();
        return true;
      case ' ':
        e.preventDefault();
        focusComposer();
        return true;
      case 'a': case 'A': flow.accept(); return true;
      case 'r': case 'R': flow.reject(); return true;
      case 's': case 'S': flow.skip(); return true;
      case 'd': case 'D': flow.done(); return true;
      default: return false;
    }
  }, { priority: OVERLAY_DISMISS_PRIORITY, enabled });
}

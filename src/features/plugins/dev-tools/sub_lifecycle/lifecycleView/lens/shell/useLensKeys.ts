/**
 * The Lens keyboard: the same key means the same move on every plane.
 *
 *   ← / →   the step (the lit column; inside a detail the step screen walks it)
 *   ↑ / ↓   the item in the lit column, or the row in a list
 *   Enter   one level deeper
 *   Esc     one level up (inside a detail the step screen takes it)
 *   [ / ]   the previous / next project by attention, on a project and its detail
 *
 * Registered on the app's keyboard ladder at the route rung, so a dialog over
 * the page takes its keys first. A key typed into a field is the field's.
 */
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [role="combobox"], [role="dialog"]') !== null;
}

export interface LensKeyHandlers {
  /** Called for every key the page sees (the arrival animation ends on any key). */
  any?: () => void;
  /** False on a detail: the step screen owns ←/→/Esc there. */
  field: boolean;
  step: (delta: -1 | 1) => void;
  item: (delta: -1 | 1) => void;
  enter: () => void;
  back: () => void;
  /** Null where there is no project to walk. */
  project: ((delta: -1 | 1) => void) | null;
}

export function useLensKeys(h: LensKeyHandlers): void {
  useAppKeyboard(
    (e) => {
      h.any?.();
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return false;
      if ((e.key === '[' || e.key === ']') && h.project) {
        e.preventDefault();
        h.project(e.key === ']' ? 1 : -1);
        return true;
      }
      if (!h.field) return false;
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); h.step(-1); return true;
        case 'ArrowRight': e.preventDefault(); h.step(1); return true;
        case 'ArrowUp': e.preventDefault(); h.item(-1); return true;
        case 'ArrowDown': e.preventDefault(); h.item(1); return true;
        case 'Enter': e.preventDefault(); h.enter(); return true;
        case 'Escape': h.back(); return true;
        default: return false;
      }
    },
    { priority: ROUTE_DECISION_PRIORITY },
  );
}

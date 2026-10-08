// Layer 2's keyboard: Esc returns to Layer 1, Left / Right walk to the
// neighbouring step's screen without returning. Registered on the app's
// keyboard ladder at the route rung, so a modal opened from the screen (the
// docs change log) takes Escape first. A key typed into a field is the
// field's: the commands editor's inputs keep their arrows and their Escape.
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [role="combobox"], [role="listbox"]') !== null;
}

export function useStepKeys(handlers: { back: () => void; prev: (() => void) | null; next: (() => void) | null }) {
  useAppKeyboard(
    (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return false;
      if (e.key === 'Escape') {
        handlers.back();
        return true;
      }
      const walk = e.key === 'ArrowLeft' ? handlers.prev : e.key === 'ArrowRight' ? handlers.next : null;
      if (!walk) return false;
      e.preventDefault();
      walk();
      return true;
    },
    { priority: ROUTE_DECISION_PRIORITY },
  );
}

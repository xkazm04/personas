import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isFreeKey } from '../useDecisionKeys';

// The Guide layout's single-letter keys: O tools, G add a goal, B blueprint,
// Esc steps back. On the app keyboard ladder at the route-decision rung, so any
// overlay above the route (a modal, the tool arc) takes the key first; ignored
// while typing, with a modifier held, or while a popover is open. Esc has its
// own switch (it also tucks away a question while a project is drafted, when
// the letter keys are off) and is only consumed when it actually did something.
export function useGuideKeys(h: {
  enabled: boolean;
  escapeEnabled: boolean;
  onTools: () => void;
  onAddGoal: () => void;
  onToggleBlueprint: () => void;
  onEscape: () => boolean;
}) {
  useAppKeyboard(
    (e) => {
      if (!isFreeKey(e)) return false;
      if (e.key === 'Escape') {
        if (!h.escapeEnabled || !h.onEscape()) return false;
        e.preventDefault();
        return true;
      }
      if (!h.enabled) return false;
      const k = e.key.toLowerCase();
      if (k === 'o') h.onTools();
      else if (k === 'g') h.onAddGoal();
      else if (k === 'b') h.onToggleBlueprint();
      else return false;
      e.preventDefault();
      return true;
    },
    { enabled: h.enabled || h.escapeEnabled, priority: ROUTE_DECISION_PRIORITY },
  );
}

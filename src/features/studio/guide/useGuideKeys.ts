import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isFreeKey } from '../useDecisionKeys';

// The Guide layout's single-letter keys: O tools, G add a goal, B blueprint,
// Esc steps back. On the app keyboard ladder at the route-decision rung, so any
// overlay above the route (a modal, the tool arc) takes the key first; ignored
// while typing, with a modifier held, or while a popover is open.
export function useGuideKeys(h: {
  enabled: boolean;
  onTools: () => void;
  onAddGoal: () => void;
  onToggleBlueprint: () => void;
  onEscape: () => void;
}) {
  useAppKeyboard(
    (e) => {
      if (!isFreeKey(e)) return false;
      const k = e.key.toLowerCase();
      if (k === 'o') h.onTools();
      else if (k === 'g') h.onAddGoal();
      else if (k === 'b') h.onToggleBlueprint();
      else if (e.key === 'Escape') h.onEscape();
      else return false;
      e.preventDefault();
      return true;
    },
    { enabled: h.enabled, priority: ROUTE_DECISION_PRIORITY },
  );
}

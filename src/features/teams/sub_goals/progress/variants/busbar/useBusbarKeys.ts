/**
 * Busbar's key grammar, registered on the app's keyboard ladder at the route
 * rung, so a modal, the goal drawer, the command palette, the `?` cheat sheet
 * and the `;` nav mode all take their keys first.
 *
 * Only unmodified keys, never while typing, and only while focus is on the
 * page itself or inside this surface - a key pressed in the sidebar is not a
 * key for the sheet. What came over from the winner and what did not is
 * listed in BusbarStatusLine's hint table; `?` is NOT taken (the app's cheat
 * sheet owns it) and neither is `/` (no find box here).
 */
import { type RefObject } from 'react';

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import type { BusProject } from './busbarModel';
import type { BusbarState } from './useBusbarState';

function inScope(root: HTMLElement | null, target: EventTarget | null): boolean {
  if (!root || !(target instanceof Node)) return false;
  if (target === document.body) return true;
  return root.contains(target);
}

export function useBusbarKeys(
  rootRef: RefObject<HTMLElement | null>,
  s: BusbarState,
  projects: readonly BusProject[],
  onNewMilestone: () => void,
) {
  useAppKeyboard(
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (isTypingTarget(e.target) || !inScope(rootRef.current, e.target)) return false;
      const el = e.target instanceof HTMLElement ? e.target : null;
      // A real control under focus keeps its own Enter / Space.
      const onControl = !!el?.closest('button, a[href], [role="menuitem"], [role="tab"]');
      const k = e.key;
      const consume = (fn: () => void) => {
        e.preventDefault();
        fn();
        return true;
      };

      if (s.mode === 'jump') {
        if (k === 'Escape') return consume(() => s.setMode('normal'));
        const hit = projects.find((p) => p.letter && p.letter === k.toLowerCase());
        return consume(() => (hit ? s.focusProject(hit.row.projectId) : s.setMode('normal')));
      }

      if (s.mode === 'move') {
        if (k === 'Escape') return consume(() => s.setMode('normal'));
        if (/^[0-9]$/.test(k)) return consume(() => s.wireToRail(Number(k)));
        if (k === 'n') return consume(() => { s.setMode('normal'); onNewMilestone(); });
        return false;
      }

      switch (k) {
        case 'ArrowRight': case 'l': return consume(() => s.stepCursor(1));
        case 'ArrowLeft': case 'h': return consume(() => s.stepCursor(-1));
        case 'ArrowDown': case 'j': return consume(() => s.stepProject(1));
        case 'ArrowUp': case 'k': return consume(() => s.stepProject(-1));
        case 'Home': return consume(() => s.stepCursor('first'));
        case 'End': return consume(() => s.stepCursor('last'));
        case 'g': return consume(() => s.setMode('jump'));
        case 'm': return s.targets.length ? consume(() => s.setMode('move')) : false;
        case 'u': return s.targets.length ? consume(() => s.wireToRail(0)) : false;
        case 'a': return consume(s.accept);
        case 'n': return consume(onNewMilestone);
        case 'z': return s.undoDepth ? consume(() => void s.undo()) : false;
        case ' ': return onControl ? false : consume(s.toggleMark);
        case 'Enter': return onControl ? false : consume(s.openCursor);
        case 'Escape': return s.marks.size ? consume(s.clearMarks) : false;
        default:
          if (/^[1-9]$/.test(k) && s.targets.length) return consume(() => s.wireToRail(Number(k)));
          return false;
      }
    },
    { priority: ROUTE_DECISION_PRIORITY },
  );
}

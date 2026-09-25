// The fused HUD's keyboard grammar, registered at the route layer like the
// classic stage's (the bench's own handler sits above it and wins while the
// bench is up; `Q` stays the page's).
//
//   M / Shift+M   cycle the instrument: lens, bar, none
//   S             spread or fold the cross-section (from lens or none it
//                 raises the bar already spread: S always means all of it)
//   W             light the next waiting decision's stars, then none
//   F  L  /       fit, the field's magnifier, find
//   [  ]          step to the previous or next neighbour; the dial turns
//   Up / Down     rest on a row of the list; it opens in place
//   Enter         go into the row you rest on;  Esc  climb one level
//   Left / Right  in lens mode, turn the dial to the previous or next
//                 neighbour; otherwise climb and go in (a pinned technique
//                 steps to its previous or next sibling)
//   1-9           go into that numbered row
import { useCallback } from 'react';

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import { useCouncilStore } from '../../councilStore';
import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout } from '../engine/types';
import { focusNode, siblingsOf } from './fusedModel';
import { cycleMode } from './hudMode';
import { useFusedStore } from './fusedStore';
import { listKids } from './NestedList';
import type { Decision } from './fusedModel';

export function useFusedKeys(engine: GalaxyEngine | null, layout: GalaxyLayout | null, path: EnginePath, decisions: Decision[]): void {
  const handler = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!engine || !layout) return false;
      const fz = useFusedStore.getState();
      if (isTypingTarget(e.target)) return false;
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      const key = e.key;
      const lower = key.toLowerCase();
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      const step = (dir: 1 | -1) => {
        const here = path.technique ?? focusNode(path);
        if (!here) return;
        const sibs = siblingsOf(layout, here);
        const next = sibs[(sibs.indexOf(here) + dir + sibs.length) % sibs.length];
        if (next) engine.goTo(next, true);
      };
      if (key === 'Escape') {
        if (fz.finderOpen) fz.setFinderOpen(false);
        else if (!engine.climb()) return false;
        return true;
      }
      if (lower === 'm') {
        fz.setMode(cycleMode(fz.mode, e.shiftKey ? -1 : 1), true);
        return true;
      }
      if (lower === 's') {
        if (fz.mode !== 'bar') {
          fz.setSpread(true);
          fz.setMode('bar', true);
        } else fz.setSpread(!fz.spread);
        return true;
      }
      if (lower === 'w') {
        const focus = useCouncilStore.getState().focus;
        const at = focus.kind === 'council' ? decisions.findIndex((d) => d.subject.id === focus.subjectId) : -1;
        const next = decisions[at + 1];
        if (next) useCouncilStore.getState().focusCouncil(next.subject, null);
        else useCouncilStore.getState().clearCouncilFocus();
        return true;
      }
      if (lower === 'f') engine.reframe();
      else if (lower === 'l') fz.setLensOn(!fz.lensOn);
      else if (key === '/') fz.setFinderOpen(true);
      else if (key === '[' || key === ']') step(key === ']' ? 1 : -1);
      else if ((key === 'ArrowLeft' || key === 'ArrowRight') && (fz.mode === 'lens' || path.technique)) step(key === 'ArrowRight' ? 1 : -1);
      else if (key === 'ArrowDown' || key === 'ArrowUp') {
        const kids = listKids(layout, path);
        if (!kids.length) return true;
        const cur = fz.cursor && kids.includes(fz.cursor) ? kids.indexOf(fz.cursor) : path.technique ? kids.indexOf(path.technique) : -1;
        fz.setCursor(kids[Math.max(0, Math.min(kids.length - 1, cur + (key === 'ArrowDown' ? 1 : -1)))] ?? null);
      } else if ((key === 'Enter' || key === 'ArrowRight') && !onButton) {
        const kids = listKids(layout, path);
        if (!fz.cursor || !kids.includes(fz.cursor)) return false;
        engine.goTo(fz.cursor);
      } else if (key === 'ArrowLeft' && !onButton) engine.climb();
      else if (/^[1-9]$/.test(key)) {
        const kid = listKids(layout, path)[Number(key) - 1];
        if (!kid) return false;
        engine.goTo(kid);
      } else return false;
      e.preventDefault();
      return true;
    },
    [engine, layout, path, decisions],
  );
  useAppKeyboard(handler, { priority: ROUTE_DECISION_PRIORITY });
}

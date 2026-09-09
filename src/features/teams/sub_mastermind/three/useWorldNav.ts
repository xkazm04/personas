// World navigation hook — the reducer plus Athena's timeline runner. One
// instance per mounted world; timers are cleared on unmount or when a new
// command pre-empts a running one.
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { DimKey } from '../lib/dimRegistry';

import { athenaScript, type AthenaCommand } from './athenaOps';
import type { World } from './mockWorld';
import { initialWorldState, worldReducer, type WorldAction, type WorldState } from './worldModel';

export interface WorldNav {
  state: WorldState;
  dispatch: (a: WorldAction) => void;
  openProject: (slug: string) => void;
  openDim: (slug: string, dim: DimKey) => void;
  up: () => void;
  home: () => void;
  hover: (id: string | null) => void;
  runAthena: (cmd: AthenaCommand) => void;
}

export function useWorldNav(world: World): WorldNav {
  const [state, dispatch] = useReducer(worldReducer, undefined, initialWorldState);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Escape walks one layer up — the same key the 2D canvas uses to dismiss.
  //
  // Registered through the app's keyboard ladder rather than on `window`, so
  // this handler has a DECLARED POSITION against everything else competing for
  // Escape. At route priority it sits below every overlay, which is what makes
  // a BaseModal raised over the world close itself instead of the world
  // silently walking up a layer behind it. It also declines the key when there
  // is nothing to leave (level 0), so a lower rung still gets its turn.
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape' || state.focus.level === 0) return false;
      dispatch({ type: 'up' });
      return true;
    },
    { priority: ROUTE_DECISION_PRIORITY },
  );

  const runAthena = useCallback((cmd: AthenaCommand) => {
    clearTimers();
    dispatch({ type: 'busy', busy: false });
    for (const step of athenaScript(cmd, world)) {
      timers.current.push(window.setTimeout(() => {
        for (const a of step.actions) dispatch(a);
      }, step.at));
    }
  }, [clearTimers, world]);

  return useMemo<WorldNav>(() => ({
    state,
    dispatch,
    openProject: (slug) => dispatch({ type: 'open-project', slug }),
    openDim: (slug, dim) => dispatch({ type: 'open-dim', slug, dim }),
    up: () => dispatch({ type: 'up' }),
    home: () => dispatch({ type: 'home' }),
    hover: (id) => dispatch({ type: 'hover', id }),
    runAthena,
  }), [state, runAthena]);
}

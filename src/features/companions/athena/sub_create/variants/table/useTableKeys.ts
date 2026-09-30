import { useCallback, type KeyboardEvent } from 'react';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { digitAction, hearAction, isTypingTarget, primaryAction } from './tableKeys';

/**
 * Key handlers for the Table shell's root. Scoped to the shell (the root is
 * focusable and events bubble to it), never the window, so the app's global
 * shortcuts keep working elsewhere. Space is hold-to-talk on the speech card.
 */
export function useTableKeys(engine: CreateAthenaEngine, openKeys: () => void, ready: boolean) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      // A focused control activates itself on Enter/Space; never run the shell's action on top.
      if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLButtonElement) return;
      // Her line is still typing: nothing on the card exists yet except the list of keys.
      if (!ready && e.key !== '?') return;
      const { card, actions, canBack } = engine;
      let run: (() => void) | null = null;
      if (e.key === 'Enter') run = primaryAction(engine);
      else if (e.key === '?') run = openKeys;
      else if (e.key === 'Escape' && card.kind === 'intro' && card.mode === 'done') run = actions.finish;
      else if (e.key === 'b' || e.key === 'B') run = canBack ? actions.back : null;
      else if ((e.key === 's' || e.key === 'S') && card.kind !== 'intro' && card.kind !== 'handoff') run = actions.skip;
      else if (/^[1-9]$/.test(e.key)) run = digitAction(engine, Number(e.key));
      else if (e.key === ' ') {
        if (card.kind === 'stt') {
          if (!e.repeat && !card.recording) run = actions.sttStart;
          else if (e.repeat) run = () => {};
        } else run = hearAction(engine);
      }
      if (!run) return;
      e.preventDefault();
      run();
    },
    [engine, openKeys, ready],
  );

  const onKeyUp = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === ' ' && engine.card.kind === 'stt' && engine.card.recording) {
        e.preventDefault();
        engine.actions.sttStop();
      }
    },
    [engine],
  );

  return { onKeyDown, onKeyUp };
}

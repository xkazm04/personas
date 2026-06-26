import { useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useDictation, type DictationState } from './useDictation';
import { useLocalDictation } from './useLocalDictation';

/**
 * Engine-agnostic voice input. Returns whichever dictation implementation
 * the user selected (`companionSttEngine`): the browser Web Speech engine
 * (`'browser'`, default) or the local on-device whisper engine
 * (`'whisper'`). Both hooks are instantiated unconditionally (to satisfy the
 * rules of hooks) but the unselected one stays dormant — neither touches the
 * mic until its `start()` is called, and only the selected one is returned.
 */
export function useSpeechInput(args: { lang?: string } = {}): DictationState {
  const engine = useSystemStore((s) => s.companionSttEngine);
  const browser = useDictation(args);
  const local = useLocalDictation(args);
  const active = engine === 'whisper' ? local : browser;

  // Belt-and-suspenders teardown. The returned hook is picked purely from the
  // current `engine` value, so if the store flips WHILE a capture is in flight
  // the controller (`useHoldToTalk`) silently swaps its `dictation` reference
  // to the other hook — and the previously-started hook keeps capturing (mic
  // live, OS indicator on) because nothing ever calls its `stop()`. Whenever
  // the engine changes, force-`stop()` the hook that is now inactive if it's
  // still `listening`, so its MediaStream/AudioContext release even when the
  // switch came from somewhere other than the (guarded) Voice panel.
  //
  // Keyed on `engine` (not the dictation object, which is a fresh literal each
  // render) so it only runs on an actual engine switch / mount, never on every
  // render. The ref tracks the latest inactive hook so the effect reaches its
  // current `stop()`/`listening`. No-ops on mount and on idle switches because
  // `listening` is false unless a capture was genuinely in flight.
  const inactive = engine === 'whisper' ? browser : local;
  const inactiveRef = useRef(inactive);
  inactiveRef.current = inactive;
  useEffect(() => {
    const prev = inactiveRef.current;
    if (prev.listening) prev.stop();
  }, [engine]);

  return active;
}

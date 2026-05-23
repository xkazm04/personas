import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompanionStore } from './companionStore';
import { useDictation } from './useDictation';

/**
 * Shared hold-to-talk core for Athena's footer button and floating orb.
 *
 * Owns the dictation lifecycle and hands the final transcript to the
 * always-mounted `CompanionPanel` via `voiceTurnRequest`, which runs the
 * full `send()` pipeline (streaming + TTS) WITHOUT opening the panel.
 * Callers own the gesture discrimination (tap vs hold vs drag) and drive
 * this hook imperatively via {@link start} / {@link stop}.
 *
 * STT here is the browser Web Speech engine (`useDictation`). On WebView2
 * that forwards audio to the OS vendor's cloud STT; the on-device Whisper
 * engine is the separate workstream tracked in
 * `docs/features/companion/athena-orb-overlay-plan.md` §4. The mic is only
 * ever armed by an explicit `start()`, never on mount.
 */
export interface HoldToTalk {
  /** True when the browser exposes a SpeechRecognition implementation. */
  supported: boolean;
  /** True while a dictation session armed by this hook is active. */
  talking: boolean;
  /** Live interim transcript while listening — for caption affordances. */
  interimText: string;
  /** Arm the mic and begin capturing. No-op if unsupported / already armed. */
  start: () => void;
  /**
   * End the session. If the mic is live, the final transcript flushes via
   * the engine's `onend` and fires the turn; if it never started listening
   * (e.g. permission refused), state is reset so the caller's UI doesn't
   * get stuck in the listening visual.
   */
  stop: () => void;
}

export function useHoldToTalk(): HoldToTalk {
  const setVoiceTurnRequest = useCompanionStore((s) => s.setVoiceTurnRequest);
  const dictation = useDictation();
  const [talking, setTalking] = useState(false);
  const talkingRef = useRef(false);

  const start = useCallback(() => {
    if (!dictation.supported || talkingRef.current) return;
    talkingRef.current = true;
    setTalking(true);
    dictation.reset();
    dictation.start();
  }, [dictation]);

  const stop = useCallback(() => {
    if (!talkingRef.current) return;
    if (dictation.listening) {
      dictation.stop();
    } else {
      talkingRef.current = false;
      setTalking(false);
      dictation.reset();
    }
  }, [dictation]);

  // When a session ends (listening flips true → false), hand the final
  // transcript to the panel. Reading finalText on the same render is safe:
  // the engine emits its final `onresult` before `onend` flips listening off.
  const prevListeningRef = useRef(false);
  useEffect(() => {
    const wasListening = prevListeningRef.current;
    prevListeningRef.current = dictation.listening;
    if (wasListening && !dictation.listening && talkingRef.current) {
      const text = dictation.finalText.trim();
      talkingRef.current = false;
      setTalking(false);
      dictation.reset();
      if (text) setVoiceTurnRequest(text);
    }
  }, [dictation.listening, dictation.finalText, dictation, setVoiceTurnRequest]);

  return {
    supported: dictation.supported,
    talking,
    interimText: dictation.interimText,
    start,
    stop,
  };
}

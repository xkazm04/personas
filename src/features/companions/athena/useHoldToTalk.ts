import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompanionStore } from './companionStore';
import { parseSpokenDecision } from './decision/parseSpokenDecision';
import { explainDecision, runDecisionOption } from './decision/resolveDecision';
import { useSpeechInput } from './useSpeechInput';

/**
 * Shared hold-to-talk core for Athena's footer button and floating orb.
 *
 * Owns the dictation lifecycle and hands the final transcript to the
 * always-mounted `CompanionPanel` via `voiceTurnRequest`, which runs the
 * full `send()` pipeline (streaming + TTS) WITHOUT opening the panel.
 * Callers own the gesture discrimination (tap vs hold vs drag) and drive
 * this hook imperatively via {@link start} / {@link stop}.
 *
 * STT routes through `useSpeechInput`, which picks the user's engine
 * (`companionSttEngine`): the browser Web Speech engine (cloud-routed on
 * WebView2) or the local on-device whisper engine (audio stays on device).
 * The mic is only ever armed by an explicit `start()`, never on mount.
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
  /**
   * End the session WITHOUT firing a turn — discards the transcript. Used
   * for explicit cancels (e.g. pressing Esc) and when a drag supersedes an
   * armed hold.
   */
  abort: () => void;
}

export function useHoldToTalk(): HoldToTalk {
  const setVoiceTurnRequest = useCompanionStore((s) => s.setVoiceTurnRequest);
  const setVoiceCaptureActive = useCompanionStore((s) => s.setVoiceCaptureActive);
  const dictation = useSpeechInput();
  const [talking, setTalking] = useState(false);
  const talkingRef = useRef(false);
  // Set by `abort()` so the listening-end effect discards the transcript
  // instead of firing a turn.
  const abortRef = useRef(false);

  const start = useCallback(() => {
    if (!dictation.supported || talkingRef.current) return;
    talkingRef.current = true;
    abortRef.current = false;
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

  const abort = useCallback(() => {
    if (!talkingRef.current) return;
    abortRef.current = true;
    if (dictation.listening) {
      dictation.stop();
    } else {
      talkingRef.current = false;
      setTalking(false);
      dictation.reset();
    }
  }, [dictation]);

  // When a session ends (listening flips true → false), hand the final
  // transcript to the panel — unless the session was aborted. Reading
  // finalText on the same render is safe: the engine emits its final
  // `onresult` before `onend` flips listening off.
  const prevListeningRef = useRef(false);
  useEffect(() => {
    const wasListening = prevListeningRef.current;
    prevListeningRef.current = dictation.listening;
    if (wasListening && !dictation.listening && talkingRef.current) {
      const aborted = abortRef.current;
      const text = dictation.finalText.trim();
      talkingRef.current = false;
      abortRef.current = false;
      setTalking(false);
      dictation.reset();
      if (!aborted && text) {
        // Slice 7 — if a decision is pending, the user may be ANSWERING it by
        // voice ("one", "3", "explain") rather than starting a chat turn. Parse
        // the final transcript; on a valid answer, resolve the decision (run
        // the option / explain) and skip the chat turn entirely. Anything that
        // isn't a decision answer falls through to the normal pipeline.
        const decision = useCompanionStore.getState().pendingDecision;
        const answer = decision
          ? parseSpokenDecision(text, decision.options.length)
          : null;
        if (answer) {
          if (answer.kind === 'explain') {
            explainDecision();
          } else {
            const opt = decision!.options[answer.index];
            if (opt) runDecisionOption(opt);
          }
        } else {
          setVoiceTurnRequest(text);
        }
      }
    }
  }, [dictation.listening, dictation.finalText, dictation, setVoiceTurnRequest]);

  // Mirror the live capture state into the store so the Voice settings panel
  // (a different tree) can disable the STT-engine switch while a session is in
  // flight — flipping the engine mid-capture would strand the running mic. The
  // unmount cleanup clears the flag if we tear down while still talking.
  useEffect(() => {
    setVoiceCaptureActive(talking);
    return () => {
      if (talking) setVoiceCaptureActive(false);
    };
  }, [talking, setVoiceCaptureActive]);

  return {
    supported: dictation.supported,
    talking,
    interimText: dictation.interimText,
    start,
    stop,
    abort,
  };
}

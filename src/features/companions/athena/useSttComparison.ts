/**
 * Runs BOTH speech-to-text engines over one spoken take so their output
 * can be judged side by side on the operator's own microphone.
 *
 * Why simultaneous and not "record once, transcribe twice": the browser
 * engine is `SpeechRecognition`, which only ever consumes a live mic and
 * accepts no audio buffer. There is no way to replay a captured clip into
 * it, so the only fair comparison is both engines listening to the same
 * speech at the same time. That works because they open independent
 * captures (`SpeechRecognition`'s internal one, and `getUserMedia` +
 * AudioContext for whisper) and an input device is not exclusive.
 *
 * The two engines are otherwise untouched — this composes {@link useDictation}
 * and {@link useLocalDictation} exactly as the real capture paths use them,
 * so what the modal shows is what dictation would actually produce.
 *
 * Failure is per-engine on purpose: if one refuses (no mic permission for
 * the browser engine, no model downloaded for whisper), the other still
 * runs and the comparison degrades to one column instead of nothing.
 *
 * Nothing here persists. Transcripts live in component state for the life
 * of the modal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDictation, type DictationState } from './useDictation';
import { useLocalDictation } from './useLocalDictation';

/** What one engine produced for the current take. */
export interface EngineTake {
  /** Engine can run at all (API present in this webview). */
  supported: boolean;
  /** Capture or transcription still in flight. */
  busy: boolean;
  /** Final transcript for the take; empty until it lands. */
  text: string;
  /** Live partial transcript. Browser only — whisper is batch. */
  interim: string;
  /** Engine-reported failure for this take. */
  error: string | null;
  /**
   * Wall-clock ms from "stop speaking" to "transcript on screen". The
   * other half of the judgment: whisper is usually more accurate and
   * always slower, and the trade only shows if both are visible.
   */
  elapsedMs: number | null;
}

export interface SttComparison {
  recording: boolean;
  /** Either engine still working (capture or transcription). */
  busy: boolean;
  /** True once anything at all has been produced. */
  hasResult: boolean;
  browser: EngineTake;
  whisper: EngineTake;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/** Snapshot one dictation hook into the comparison's flat shape. */
function take(d: DictationState, elapsedMs: number | null, settled: boolean): EngineTake {
  return {
    supported: d.supported,
    busy: d.listening,
    text: d.finalText,
    interim: d.interimText,
    error: d.error,
    elapsedMs: settled ? elapsedMs : null,
  };
}

export function useSttComparison({ lang }: { lang?: string } = {}): SttComparison {
  const browser = useDictation({ lang });
  const whisper = useLocalDictation({ lang });

  const [recording, setRecording] = useState(false);
  // Stamped when the user stops speaking; each engine's elapsed is measured
  // from there, so the number reads as "how long until I could see it".
  const stoppedAtRef = useRef<number | null>(null);
  const [browserMs, setBrowserMs] = useState<number | null>(null);
  const [whisperMs, setWhisperMs] = useState<number | null>(null);
  // A take is "settled" for an engine once it has left listening after a
  // stop; only then is its elapsed meaningful.
  const [browserSettled, setBrowserSettled] = useState(false);
  const [whisperSettled, setWhisperSettled] = useState(false);

  // Each engine settles on its own listening→false edge after the stop.
  useEffect(() => {
    if (browser.listening || stoppedAtRef.current === null || browserSettled) return;
    setBrowserMs(Math.max(0, Math.round(performance.now() - stoppedAtRef.current)));
    setBrowserSettled(true);
  }, [browser.listening, browserSettled]);

  useEffect(() => {
    if (whisper.listening || stoppedAtRef.current === null || whisperSettled) return;
    setWhisperMs(Math.max(0, Math.round(performance.now() - stoppedAtRef.current)));
    setWhisperSettled(true);
  }, [whisper.listening, whisperSettled]);

  const start = useCallback(() => {
    stoppedAtRef.current = null;
    setBrowserMs(null);
    setWhisperMs(null);
    setBrowserSettled(false);
    setWhisperSettled(false);
    browser.reset();
    whisper.reset();
    // Fire both; a refusal surfaces in that engine's own column.
    browser.start();
    whisper.start();
    setRecording(true);
  }, [browser, whisper]);

  const stop = useCallback(() => {
    if (!recording) return;
    stoppedAtRef.current = performance.now();
    browser.stop();
    whisper.stop();
    setRecording(false);
  }, [recording, browser, whisper]);

  const reset = useCallback(() => {
    stoppedAtRef.current = null;
    setBrowserMs(null);
    setWhisperMs(null);
    setBrowserSettled(false);
    setWhisperSettled(false);
    browser.reset();
    whisper.reset();
  }, [browser, whisper]);

  // Closing the modal mid-take must not leave two mics open.
  useEffect(
    () => () => {
      browser.stop();
      whisper.stop();
    },
    // Intentionally mount-only: the hooks' own teardown handles unmount, and
    // depending on the identities here would stop capture on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const browserTake = take(browser, browserMs, browserSettled);
  const whisperTake = take(whisper, whisperMs, whisperSettled);

  return {
    recording,
    busy: recording || browser.listening || whisper.listening,
    hasResult: Boolean(
      browserTake.text || whisperTake.text || browserTake.error || whisperTake.error,
    ),
    browser: browserTake,
    whisper: whisperTake,
    start,
    stop,
    reset,
  };
}

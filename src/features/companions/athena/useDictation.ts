/**
 * Push-to-talk dictation via the browser's Web Speech API.
 *
 * Wraps `webkitSpeechRecognition` (Chromium/WebView2) or the prefix-less
 * `SpeechRecognition` (where supported) into a small React-friendly
 * surface. The composer reads `interim` + `final` and pipes into its
 * textarea; the user remains free to edit before pressing Send.
 *
 * Caveats the caller MUST surface:
 *   - On Chromium-based WebViews the audio stream is forwarded to a cloud
 *     STT endpoint owned by the browser vendor (Google for Chrome, Microsoft
 *     for Edge/WebView2). The user's speech leaves the device. Document this
 *     near the mic affordance and gate it behind an explicit click — never
 *     auto-start.
 *   - WebKit (macOS) does not currently expose either symbol. The hook
 *     reports `supported: false` so the UI can hide the affordance instead
 *     of presenting a dead button.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';

export interface DictationState {
  /** True if the browser exposes a SpeechRecognition implementation. */
  supported: boolean;
  /** True while a recognition session is active. */
  listening: boolean;
  /** Latest finalized chunk emitted in this session. Empty until first final result. */
  finalText: string;
  /** Live interim transcript — updates rapidly while the user speaks. */
  interimText: string;
  /** Last error code reported by the engine, e.g. `not-allowed` / `network`. */
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Reset finalText/interimText/error to empty. */
  reset: () => void;
}

interface UseDictationArgs {
  /** Recognition language. Defaults to the document's lang attribute or `'en-US'`. */
  lang?: string;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function detectCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation({ lang }: UseDictationArgs = {}): DictationState {
  const ctorRef = useRef<SpeechRecognitionCtor | null>(null);
  if (ctorRef.current === null) ctorRef.current = detectCtor();
  const supported = !!ctorRef.current;

  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Tear down on unmount so we don't leak the engine's listener handles.
  useEffect(() => {
    return () => {
      const r = recognitionRef.current;
      if (r) {
        r.onresult = null;
        r.onerror = null;
        r.onend = null;
        try {
          r.abort();
        } catch (err) {
          silentCatch('useDictation.unmount.abort')(err);
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    if (!ctorRef.current || listening) return;
    const r = new ctorRef.current();
    r.lang = lang ?? document.documentElement.lang ?? 'en-US';
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i];
        if (!seg) continue;
        if (seg.isFinal) final += seg[0].transcript;
        else interim += seg[0].transcript;
      }
      if (final) setFinalText((prev) => (prev ? `${prev} ${final}` : final).trim());
      setInterimText(interim.trim());
    };
    r.onerror = (e) => {
      setError(e.error || 'unknown');
    };
    r.onend = () => {
      setListening(false);
      setInterimText('');
    };
    recognitionRef.current = r;
    setError(null);
    setFinalText('');
    setInterimText('');
    try {
      r.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'start_failed');
      setListening(false);
    }
  }, [lang, listening]);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch (err) {
      silentCatch('useDictation.stop')(err);
    }
  }, []);

  const reset = useCallback(() => {
    setFinalText('');
    setInterimText('');
    setError(null);
  }, []);

  return { supported, listening, finalText, interimText, error, start, stop, reset };
}

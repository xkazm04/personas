import { useCallback, useEffect, useRef, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import { useSpeechInput } from '@/features/plugins/companion/useSpeechInput';
import { useTtsSettings } from '@/features/plugins/companion/useTtsSettings';
import { useTtsVoiceSelection } from '@/features/plugins/companion/useTtsVoiceSelection';
import { play, synthesize } from '@/features/plugins/companion/voicePlayback';
import { stripMarkdownForSpeech } from '@/features/plugins/companion/chat/athenaChatSpeech';
import type { SetupSessionApi, SetupVoiceApi } from './setupContract';

/**
 * Voice for the Setup conversation — dictation in, the guide's question out.
 *
 * The rules this holds, and why each one exists:
 *
 * - **Interim text is displayed, never submitted.** A running transcript is a
 *   guess the engine is still revising; acting on it sends half a sentence.
 *   Only a FINAL transcript reaches `session.answer`.
 * - **Hands-free is OFF by default and is an explicit choice.** With it on, a
 *   final transcript is submitted after a short silence and the next question
 *   is spoken. With it off, the final transcript is offered and the user
 *   presses send.
 * - **`supported: false` is an honest end state.** When no engine exists the
 *   controls say so in one line; nothing spins, and nothing waits for a
 *   capability that is not coming.
 * - **`stop` takes effect immediately** — it stops the engine and drops any
 *   pending auto-submit, so releasing the control cannot post an answer a
 *   moment later.
 */

/**
 * Silence after a final transcript before hands-free submits it. Long enough
 * that a pause mid-thought does not truncate an answer, short enough that the
 * conversation does not stall waiting for the user to realise it is their turn.
 */
const HANDS_FREE_SETTLE_MS = 1200;

export function useSetupVoice(session: SetupSessionApi): SetupVoiceApi {
  const dictation = useSpeechInput();
  const voice = useTtsVoiceSelection();
  const ttsSettings = useTtsSettings();

  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [speakError, setSpeakError] = useState<string | null>(null);

  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const spokenRef = useRef<string | null>(null);

  // `answer` changes identity between renders; the settle timer reads it
  // through a ref so a scheduled submit always calls the current one.
  const answerRef = useRef(session.answer);
  answerRef.current = session.answer;

  const clearPendingSubmit = useCallback(() => {
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      const clean = stripMarkdownForSpeech(text).trim();
      if (!clean || !voice.configured) return;
      // Fire-and-forget by contract: the flow never waits on speech, so a slow
      // or failed synthesis can delay a sentence but never a question.
      void (async () => {
        try {
          stopPlayback();
          const url = await synthesize(
            clean,
            voice.credentialId,
            voice.voiceId ?? '',
            ttsSettings,
            voice.engine,
          );
          objectUrlRef.current = url;
          const { audio, done } = play(url);
          audioRef.current = audio;
          setSpeakError(null);
          try {
            await done;
          } catch (err) {
            // A pause (the user pressed stop) is not a failure.
            silentCatch('features/plugins/twin/setup/useSetupVoice:play')(err);
          }
          if (audioRef.current === audio) stopPlayback();
        } catch (err) {
          silentCatch('features/plugins/twin/setup/useSetupVoice:synthesize')(err);
          setSpeakError('tts');
        }
      })();
    },
    [voice, ttsSettings, stopPlayback],
  );

  const speakRef = useRef(speak);
  speakRef.current = speak;

  const start = useCallback(() => {
    if (!dictation.supported) return;
    clearPendingSubmit();
    dictation.reset();
    dictation.start();
  }, [dictation, clearPendingSubmit]);

  /**
   * Immediate by design: the engine is stopped and any scheduled hands-free
   * submit is cancelled in the same tick, so a stop can never be overtaken by
   * a settle timer that was already counting down.
   */
  const stop = useCallback(() => {
    clearPendingSubmit();
    dictation.stop();
  }, [dictation, clearPendingSubmit]);

  const toggleSpeak = useCallback(() => {
    setSpeakEnabled((on) => {
      if (on) stopPlayback();
      return !on;
    });
  }, [stopPlayback]);

  const toggleHandsFree = useCallback(() => {
    setHandsFree((on) => {
      if (on) clearPendingSubmit();
      return !on;
    });
  }, [clearPendingSubmit]);

  // Hands-free submit. Only FINAL text is ever eligible; `interimText` is
  // rendered by the variants and deliberately not read here.
  const finalText = dictation.finalText;
  useEffect(() => {
    if (!handsFree) return;
    const text = finalText.trim();
    if (!text) return;
    const timer = setTimeout(() => {
      submitTimerRef.current = null;
      dictation.reset();
      void answerRef.current(text);
    }, HANDS_FREE_SETTLE_MS);
    submitTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (submitTimerRef.current === timer) submitTimerRef.current = null;
    };
    // `dictation` is a fresh object each render; depending on it would restart
    // the settle timer on every keystroke elsewhere in the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalText, handsFree, clearPendingSubmit]);

  // Speak each new question once, and only when speaking is switched on.
  useEffect(() => {
    const question = session.question;
    if (!speakEnabled || !question) return;
    if (spokenRef.current === question) return;
    spokenRef.current = question;
    speakRef.current(question);
  }, [session.question, speakEnabled]);

  // Release the engine and the audio bytes on unmount.
  useEffect(
    () => () => {
      clearPendingSubmit();
      stopPlayback();
    },
    [clearPendingSubmit, stopPlayback],
  );

  return {
    supported: dictation.supported,
    listening: dictation.listening,
    interim: dictation.interimText,
    // The dictation engine's error wins: a failed mic is what blocks the user,
    // while a failed voice-out only makes the guide silent.
    error: dictation.error ?? speakError,
    speakEnabled,
    handsFree,
    start,
    stop,
    toggleSpeak,
    toggleHandsFree,
    speak,
  };
}

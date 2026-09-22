/**
 * Two exclusive audio channels, so Athena can never talk over herself.
 *
 *  - **Progress** — short filler while a turn runs (an ack, a heartbeat, or one
 *    of her own `PROGRESS:` beats). Latest wins; the previous clip is stopped.
 *  - **Main** — the committed reply. Starting one cuts off any progress clip AND
 *    any still-playing prior reply, so back-to-back turns (a non-blocking
 *    composer send, an autonomous beat) don't overlap.
 *
 * Each channel owns exactly one `HTMLAudioElement` and one blob URL, and always
 * revokes the URL it replaces — a long session otherwise accumulates ~50KB of
 * un-GC-able blob per spoken reply.
 */

import { useCallback, useEffect, useRef } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from '../companionStore';
import { play as playAudio, synthesize as synthesizeTts } from '../voicePlayback';
import type { useTtsSettings } from '../useTtsSettings';
import type { ResolvedTtsVoice } from '../useTtsVoiceSelection';

export interface AthenaChatAudio {
  stopProgress: () => void;
  stopMain: () => void;
  /** Speak filler. No-ops when voice is off or the real reply is already queued. */
  playProgress: (text: string) => void;
  /** Speak the committed reply. Silences both channels first. */
  playMain: (text: string) => void;
}

export function useAthenaChatAudio(args: {
  voiceActive: boolean;
  voice: ResolvedTtsVoice;
  voiceSettings: ReturnType<typeof useTtsSettings>;
}): AthenaChatAudio {
  const { voiceActive, voice, voiceSettings } = args;
  const { credentialId, voiceId, engine } = voice;

  const progressAudioRef = useRef<HTMLAudioElement | null>(null);
  const progressUrlRef = useRef<string | null>(null);
  const mainAudioRef = useRef<HTMLAudioElement | null>(null);
  const mainUrlRef = useRef<string | null>(null);

  const stopProgress = useCallback(() => {
    progressAudioRef.current?.pause();
    progressAudioRef.current = null;
    if (progressUrlRef.current) {
      URL.revokeObjectURL(progressUrlRef.current);
      progressUrlRef.current = null;
    }
  }, []);

  const stopMain = useCallback(() => {
    mainAudioRef.current?.pause();
    mainAudioRef.current = null;
    if (mainUrlRef.current) {
      URL.revokeObjectURL(mainUrlRef.current);
      mainUrlRef.current = null;
    }
  }, []);

  const playProgress = useCallback(
    (text: string) => {
      if (!voiceActive || !voiceId) return;
      if (useCompanionStore.getState().pendingPlayback) return;
      stopProgress();
      synthesizeTts(text, credentialId, voiceId, voiceSettings, engine)
        .then((url) => {
          // Re-check: the reply may have landed while we were synthesizing.
          if (useCompanionStore.getState().pendingPlayback) {
            URL.revokeObjectURL(url);
            return;
          }
          progressUrlRef.current = url;
          const { audio, done } = playAudio(url);
          progressAudioRef.current = audio;
          done.catch(silentCatch('companion_voice_progress_play')).finally(() => {
            if (progressUrlRef.current !== url) return;
            URL.revokeObjectURL(url);
            progressUrlRef.current = null;
            progressAudioRef.current = null;
          });
        })
        .catch(silentCatch('companion_voice_progress_synthesize'));
    },
    [voiceActive, voiceId, credentialId, voiceSettings, engine, stopProgress],
  );

  const playMain = useCallback(
    (text: string) => {
      if (!voiceActive || !voiceId) return;
      stopProgress();
      stopMain();
      synthesizeTts(text, credentialId, voiceId, voiceSettings, engine)
        .then((url) => {
          useCompanionStore.getState().setPlaybackAudioUrl(url);
          mainUrlRef.current = url;
          const { audio, done } = playAudio(url);
          mainAudioRef.current = audio;
          done
            .then(() => useCompanionStore.getState().markPlaybackPlayed())
            .catch(silentCatch('companion_tts_play'))
            .finally(() => {
              if (mainUrlRef.current !== url) return;
              URL.revokeObjectURL(url);
              mainUrlRef.current = null;
              mainAudioRef.current = null;
            });
        })
        .catch(silentCatch('companion_tts_synthesize'));
    },
    [voiceActive, voiceId, credentialId, voiceSettings, engine, stopProgress, stopMain],
  );

  // Release both channels if the panel unmounts mid-speech.
  useEffect(() => () => {
    stopProgress();
    stopMain();
  }, [stopProgress, stopMain]);

  return { stopProgress, stopMain, playProgress, playMain };
}

/**
 * Spoken turn choreography — "no dead air" while Athena works.
 *
 * Two generic tiers (an ack at ~2.5s, a heartbeat after ~30s of CLI silence)
 * fire at most once per turn, and BOTH stand down the moment Athena emits a
 * `PROGRESS:` beat of her own: her words beat filler.
 *
 * The beat scanner subscribes to the store IMPERATIVELY rather than with a
 * selector. `streamingText` changes on every animation frame of a reply, and a
 * `useCompanionStore(s => s.streamingText)` here would re-render the entire
 * chat body — and with it every mounted bubble — dozens of times a second, for
 * a value nothing renders. Audio channels live in `athenaChatAudio.ts`.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { useTtsSettings } from '../useTtsSettings';
import { useTtsVoiceSelection, type ResolvedTtsVoice } from '../useTtsVoiceSelection';
import { useAthenaChatAudio } from './athenaChatAudio';

/** Delay before the generic "one moment" ack speaks on a still-running turn. */
const ACK_DELAY_MS = 2500;
/** CLI silence after which the heartbeat speaks, once per turn. */
const HEARTBEAT_SILENCE_MS = 30_000;
/** How often the heartbeat checks the silence clock. */
const HEARTBEAT_POLL_MS = 5000;

export interface AthenaChatVoice {
  voice: ResolvedTtsVoice;
  voiceSettings: ReturnType<typeof useTtsSettings>;
  /** Voice is on AND the selected engine has everything it needs. */
  voiceActive: boolean;
  /** Reset per-turn spoken bookkeeping and silence any in-flight filler. */
  resetTurnProgress: () => void;
  playProgressClip: (text: string) => void;
  /** Speak the committed reply, cutting off filler and any prior reply. */
  playSpokenReply: (ttsText: string) => void;
}

export function useAthenaChatVoice(args: {
  streaming: boolean;
  lastStreamEventAtRef: React.MutableRefObject<number>;
}): AthenaChatVoice {
  const { streaming, lastStreamEventAtRef } = args;
  const { t } = useTranslation();

  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const voice = useTtsVoiceSelection();
  const voiceSettings = useTtsSettings();
  const voiceActive = voiceEnabled && voice.configured;
  const audio = useAthenaChatAudio({ voiceActive, voice, voiceSettings });
  const { playProgress, stopProgress } = audio;

  // Which generic tiers already spoke this turn, whether Athena beat us to it,
  // and how many of her beats we've already fired (`streamingText` only grows,
  // so we re-scan and act on the new tail).
  const spokenTiersRef = useRef<Set<number>>(new Set());
  const beatFiredRef = useRef(false);
  const beatsFiredRef = useRef(0);

  const resetTurnProgress = useCallback(() => {
    spokenTiersRef.current.clear();
    beatFiredRef.current = false;
    beatsFiredRef.current = 0;
    stopProgress();
  }, [stopProgress]);

  const speakTier = useCallback(
    (text: string, tier: number) => {
      if (beatFiredRef.current) return;
      if (spokenTiersRef.current.has(tier)) return;
      spokenTiersRef.current.add(tier);
      playProgress(text);
    },
    [playProgress],
  );

  // Ack: ~2.5s into a still-running turn. Fast turns never reach it.
  useEffect(() => {
    if (!streaming) {
      stopProgress();
      return;
    }
    const id = window.setTimeout(() => {
      speakTier(t.plugins.companion.voice_progress_ack, 0);
    }, ACK_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [streaming, speakTier, stopProgress, t]);

  // Heartbeat: once the CLI has been silent for ~30s. Polls a ref rather than
  // deriving from rendered state, so it costs no re-render.
  useEffect(() => {
    if (!streaming) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastStreamEventAtRef.current > HEARTBEAT_SILENCE_MS) {
        speakTier(t.plugins.companion.voice_progress_working, 1);
      }
    }, HEARTBEAT_POLL_MS);
    return () => window.clearInterval(id);
  }, [streaming, speakTier, lastStreamEventAtRef, t]);

  // Model-authored `PROGRESS:` beats — show + speak each once as its line
  // completes. A newline is what makes a line "complete", so the trailing
  // segment is always skipped. See the file header for why this isn't a
  // selector subscription.
  useEffect(() => {
    let prevText = useCompanionStore.getState().streamingText;
    return useCompanionStore.subscribe((state) => {
      const text = state.streamingText;
      if (text === prevText) return;
      prevText = text;
      if (!state.streaming) {
        beatsFiredRef.current = 0;
        return;
      }
      const parts = text.split('\n');
      const beats: string[] = [];
      for (let i = 0; i < parts.length - 1; i++) {
        const body = /^\s*PROGRESS:\s*(.+)$/.exec(parts[i] ?? '')?.[1]?.trim();
        if (body) beats.push(body);
      }
      if (beats.length <= beatsFiredRef.current) return;
      const turnStamp = Date.now();
      for (let i = beatsFiredRef.current; i < beats.length; i++) {
        const beat = beats[i]!;
        beatFiredRef.current = true;
        const store = useCompanionStore.getState();
        store.setStreamingBeat(beat);
        // Log into the narration timeline so the beat survives in the persisted
        // turn sidecar rather than being latest-wins only.
        store.appendNarrationEntry({
          id: `beat_${turnStamp}_${i}`,
          kind: 'beat',
          text: beat,
          at: turnStamp,
        });
        playProgress(beat);
      }
      beatsFiredRef.current = beats.length;
    });
  }, [playProgress]);

  return {
    voice,
    voiceSettings,
    voiceActive,
    resetTurnProgress,
    playProgressClip: playProgress,
    playSpokenReply: audio.playMain,
  };
}

/**
 * Spoken turn choreography — "no dead air" while Athena works.
 *
 * Two generic tiers (an ack at ~2.5s, a heartbeat after ~30s of CLI silence)
 * fire at most once per turn, and BOTH stand down the moment Athena emits a
 * `PROGRESS:` beat of her own or her first streamed sentence is spoken: her
 * words beat filler.
 *
 * Speech starts on the first COMPLETED sentence of the streamed prose (the
 * voice contract in `docs/architecture/hybrid-llm-engine.md`): `speechChunker`
 * turns the growing `streamingText` into sentences, and a small sequential
 * queue speaks them back to back on the main channel, synthesizing the next
 * while the current plays. A turn whose prose was spoken this way marks
 * itself `proseSpoken`, and the send pipeline then ignores the trailing
 * `tts_text` so the answer is never heard twice.
 *
 * The scanners subscribe to the store IMPERATIVELY rather than with a
 * selector. `streamingText` changes on every animation frame of a reply, and a
 * `useCompanionStore(s => s.streamingText)` here would re-render the entire
 * chat body — and with it every mounted bubble — dozens of times a second, for
 * a value nothing renders. Audio channels live in `athenaChatAudio.ts`.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { useTtsSettings } from '../useTtsSettings';
import { useTtsVoiceSelection, type ResolvedTtsVoice } from '../useTtsVoiceSelection';
import { play as playAudio, synthesize as synthesizeTts } from '../voicePlayback';
import { useAthenaChatAudio } from './athenaChatAudio';
import { stripMarkdownForSpeech } from './athenaChatSpeech';
import { createSpeechChunker } from './speechChunker';

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
  /** True once at least one streamed sentence of this turn was spoken. */
  wasProseSpoken: () => boolean;
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
  const { playProgress, stopProgress, stopMain } = audio;
  const { credentialId, voiceId, engine } = voice;

  // Which generic tiers already spoke this turn, whether Athena beat us to it,
  // and how many of her beats we've already fired (`streamingText` only grows,
  // so we re-scan and act on the new tail).
  const spokenTiersRef = useRef<Set<number>>(new Set());
  const beatFiredRef = useRef(false);
  const beatsFiredRef = useRef(0);
  const proseSpokenRef = useRef(false);

  // Sequential sentence queue. `play().done` never settles for a paused clip,
  // so a drain loop is retired by bumping the generation, never by awaiting it.
  const sentenceQueueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const generationRef = useRef(0);
  const sentenceAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopSentences = useCallback(() => {
    generationRef.current += 1;
    sentenceQueueRef.current = [];
    drainingRef.current = false;
    sentenceAudioRef.current?.pause();
    sentenceAudioRef.current = null;
  }, []);

  const drainSentences = useCallback(async () => {
    if (drainingRef.current || !voiceId) return;
    drainingRef.current = true;
    const gen = generationRef.current;
    const live = () => gen === generationRef.current;
    const synthNext = (): Promise<string> | null => {
      const text = sentenceQueueRef.current.shift();
      return text == null ? null : synthesizeTts(text, credentialId, voiceId, voiceSettings, engine);
    };
    try {
      let next = synthNext();
      while (next && live()) {
        const url = await next.catch((e: unknown) => {
          silentCatch('companion_voice_sentence_synthesize')(e);
          return null;
        });
        // Pipeline: the next sentence synthesizes while this one plays.
        next = synthNext();
        if (!url) continue;
        if (!live()) {
          URL.revokeObjectURL(url);
          break;
        }
        const { audio: el, done } = playAudio(url);
        sentenceAudioRef.current = el;
        await done.catch(silentCatch('companion_voice_sentence_play'));
        URL.revokeObjectURL(url);
        if (!next) next = synthNext();
      }
    } finally {
      if (live()) drainingRef.current = false;
    }
  }, [voiceId, credentialId, voiceSettings, engine]);

  const speakSentence = useCallback(
    (sentence: string) => {
      if (!voiceActive || !voiceId) return;
      const text = stripMarkdownForSpeech(sentence);
      if (!text) return;
      if (!proseSpokenRef.current) {
        // First spoken sentence: filler and any prior reply stand down.
        proseSpokenRef.current = true;
        beatFiredRef.current = true;
        stopProgress();
        stopMain();
      }
      sentenceQueueRef.current.push(text);
      void drainSentences();
    },
    [voiceActive, voiceId, stopProgress, stopMain, drainSentences],
  );

  const resetTurnProgress = useCallback(() => {
    spokenTiersRef.current.clear();
    beatFiredRef.current = false;
    beatsFiredRef.current = 0;
    proseSpokenRef.current = false;
    stopSentences();
    stopProgress();
  }, [stopProgress, stopSentences]);

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
  // completes — and the streamed prose, spoken sentence by sentence. A newline
  // is what makes a beat "complete"; a terminator plus whitespace (or a blank
  // line) is what completes a sentence, so the trailing segment is always
  // skipped until the turn ends and the chunker is flushed. See the file
  // header for why this isn't a selector subscription.
  useEffect(() => {
    const chunker = createSpeechChunker();
    let prevText = useCompanionStore.getState().streamingText;
    return useCompanionStore.subscribe((state) => {
      const text = state.streamingText;
      if (text === prevText) return;
      prevText = text;
      if (!state.streaming) {
        beatsFiredRef.current = 0;
        // Only a turn already speaking its prose flushes its tail; otherwise
        // the committed `tts_text` path owns the reply, as before.
        if (proseSpokenRef.current) chunker.flush().forEach(speakSentence);
        chunker.reset();
        return;
      }
      chunker.push(text).forEach(speakSentence);
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
        // Once prose is being spoken, a beat is shown but no longer voiced
        // over it: her sentences outrank her progress line.
        if (!proseSpokenRef.current) playProgress(beat);
      }
      beatsFiredRef.current = beats.length;
    });
  }, [playProgress, speakSentence]);

  // Release the sentence channel if the panel unmounts mid-speech.
  useEffect(() => () => stopSentences(), [stopSentences]);

  const wasProseSpoken = useCallback(() => proseSpokenRef.current, []);

  return {
    voice,
    voiceSettings,
    voiceActive,
    resetTurnProgress,
    playProgressClip: playProgress,
    playSpokenReply: audio.playMain,
    wasProseSpoken,
  };
}

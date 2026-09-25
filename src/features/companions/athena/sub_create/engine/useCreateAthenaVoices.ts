/**
 * Create Athena — voice list + preview for the `voice_pick` step. The
 * preview is the moment Athena first speaks: the first successful play
 * uses a time-of-day wake-up line and reports back through `onWoke`; every
 * later play uses `voice_test_sentence` so voices can be compared.
 *
 * Blob lifecycle mirrors `useVoicePreview` (`sub_voice/voiceEngineShared.tsx`):
 * synth → play → pause + `revokeObjectURL` on completion, error, stop, or
 * unmount. A generation counter makes a superseded preview inert.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  companionTtsListKokoroVoices,
  companionTtsListPocketVoices,
  type TtsEngineId,
} from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { stripMarkdownForSpeech } from '@/features/companions/athena/chat/athenaChatSpeech';
import { synthesize, play } from '@/features/companions/athena/voicePlayback';
import { useTtsSettings } from '@/features/companions/athena/useTtsSettings';
import { createLatestWins } from '@/stores/util/latestWins';
import { pickWakeUpLine } from './createAthenaSteps';
import type { VoiceOption } from './createAthenaTypes';

type PreviewState = 'idle' | 'synth' | 'playing';

export interface CreateAthenaVoices {
  voices: VoiceOption[];
  /** Only while the list is empty AND a fetch is in flight. */
  loading: boolean;
  preview: PreviewState;
  previewVoiceId: string | null;
  speaking: boolean;
  previewVoice: (voiceId: string) => void;
  stopPreview: () => void;
}

interface Args {
  engine: TtsEngineId;
  /** The step is on screen — fetch the list, otherwise leave IPC alone. */
  active: boolean;
  wokeUp: boolean;
  /** First successful play: the engine flips `wokeUp` and selects the voice. */
  onWoke: (voiceId: string) => void;
}

export function useCreateAthenaVoices({ engine, active, wokeUp, onWoke }: Args): CreateAthenaVoices {
  const { t } = useTranslation();
  const settings = useTtsSettings();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<PreviewState>('idle');
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  // Latest-wins gate: a newer preview (or a stop) makes an older one inert.
  const gate = useRef(createLatestWins()).current;
  const wokeUpRef = useRef(wokeUp);
  wokeUpRef.current = wokeUp;
  const onWokeRef = useRef(onWoke);
  onWokeRef.current = onWoke;

  // --- list -------------------------------------------------------------
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setVoices([]);
    setFetching(true);
    const load =
      engine === 'kokoro'
        ? companionTtsListKokoroVoices().then((rows) =>
            rows.map<VoiceOption>((v) => ({
              voiceId: v.voiceId,
              label: v.speaker,
              meta: `${v.languageLabel} · ${v.gender} · ${v.grade}`,
            })),
          )
        : companionTtsListPocketVoices().then((rows) =>
            rows.map<VoiceOption>((v) => ({
              voiceId: v.voiceId,
              label: v.name,
              meta: v.category || null,
            })),
          );
    load
      .then((list) => {
        if (!cancelled) setVoices(list);
      })
      .catch(silentCatch(`createAthena.voices.${engine}`))
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, active]);

  // --- preview ----------------------------------------------------------
  const cleanup = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stopPreview = useCallback(() => {
    gate.next();
    cleanup();
    setPreview('idle');
    setPreviewVoiceId(null);
  }, [cleanup, gate]);

  useEffect(() => stopPreview, [stopPreview]);

  const previewVoice = useCallback(
    (voiceId: string) => {
      // A preview in flight is stopped first — one voice at a time.
      cleanup();
      const gen = gate.next();
      setPreview('synth');
      setPreviewVoiceId(voiceId);
      const c = t.athena;
      const raw = wokeUpRef.current ? c.voice_test_sentence : pickWakeUpLine(c, new Date());
      const text = stripMarkdownForSpeech(raw);
      void (async () => {
        try {
          const url = await synthesize(text, null, voiceId, settings, engine);
          if (!gate.isCurrent(gen)) {
            URL.revokeObjectURL(url);
            return;
          }
          urlRef.current = url;
          const { audio, done } = play(url);
          audioRef.current = audio;
          setPreview('playing');
          await done;
          if (!gate.isCurrent(gen)) return;
          cleanup();
          setPreview('idle');
          setPreviewVoiceId(null);
          if (!wokeUpRef.current) onWokeRef.current(voiceId);
        } catch (e) {
          silentCatch(`createAthena.preview.${engine}`)(e);
          if (!gate.isCurrent(gen)) return;
          cleanup();
          setPreview('idle');
          setPreviewVoiceId(null);
        }
      })();
    },
    [cleanup, gate, t, settings, engine],
  );

  return {
    voices,
    loading: fetching && voices.length === 0,
    preview,
    previewVoiceId,
    speaking: preview === 'playing',
    previewVoice,
    stopPreview,
  };
}

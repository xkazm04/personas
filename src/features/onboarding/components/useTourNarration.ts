import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { synthesize, play } from '@/features/plugins/companion/voicePlayback';
import { useTtsSettings } from '@/features/plugins/companion/useTtsSettings';

/**
 * Athena-narrated guided tour (prototype).
 *
 * Bridges the existing text-only `GuidedTour` step engine to the companion's
 * live TTS so Athena speaks each step as it activates. Design contract:
 *
 *   - The tour engine still owns step order, route navigation, the spotlight,
 *     and `completeOn` advancement. This hook is purely additive audio — it
 *     never advances or blocks a step.
 *   - Narration plays ONLY when the companion's voice is configured (the
 *     `companionVoiceEnabled` master switch is on AND the selected engine has
 *     a usable voice). With no voice set up, `available` is false and the
 *     tour behaves exactly as it did before — a silent text coach-mark.
 *   - Synthesis is live via `companion_tts` (ElevenLabs or local Piper),
 *     reusing the same `synthesize`/`play` pipeline as Athena's chat replies.
 *     `play()` routes through the shared analyser, so the orb glow reacts to
 *     the narration for free.
 *   - TTS is best-effort: any synth/playback failure is swallowed
 *     (`silentCatch`) and surfaced only as an `error` status on the control —
 *     it must never break the tour.
 *
 * Forward-looking: keeping narration as per-step metadata (rather than a
 * baked audio file) is what will later let Athena answer free-form questions
 * mid-tour through the same synth path.
 */

export type TourNarrationStatus =
  | 'idle' // available, not currently speaking
  | 'loading' // synthesizing
  | 'speaking' // audio playing
  | 'error'; // last attempt failed

export interface TourNarrationControl {
  /** True when voice is configured AND the active step has narration text. */
  available: boolean;
  status: TourNarrationStatus;
  /** Session-scoped mute. When muted, step activation won't auto-speak. */
  muted: boolean;
  toggleMute: () => void;
  /** Replay the current step's narration on demand (ignores mute). */
  replay: () => void;
}

interface UseTourNarrationParams {
  /** Tour is active and the panel is visible (not minimized/closed). */
  active: boolean;
  /** Current step id — drives "speak once per step activation". */
  stepId: string | null;
  /** Spoken text for the current step, if any. */
  narration: string | undefined;
}

export function useTourNarration({
  active,
  stepId,
  narration,
}: UseTourNarrationParams): TourNarrationControl {
  const voice = useSystemStore(
    useShallow((s) => ({
      enabled: s.companionVoiceEnabled,
      engine: s.companionVoiceEngine,
      credentialId: s.companionVoiceCredentialId,
      elevenVoiceId: s.companionVoiceId,
      piperVoiceId: s.companionPiperVoiceId,
    })),
  );
  const settings = useTtsSettings();

  const voiceConfigured =
    voice.enabled &&
    (voice.engine === 'elevenlabs'
      ? Boolean(voice.credentialId && voice.elevenVoiceId)
      : Boolean(voice.piperVoiceId));

  const available = voiceConfigured && Boolean(narration);

  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState<TourNarrationStatus>('idle');

  // The currently-playing audio element, so a step change / unmount / mute
  // can stop speech immediately rather than letting the prior clip finish
  // over the new step.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Monotonic token: a synth that resolves after the step has changed (or the
  // tour ended) is discarded instead of playing stale narration.
  const genRef = useRef(0);
  // Cache of object URLs per step id so replay doesn't re-hit the engine.
  const urlCacheRef = useRef<Map<string, string>>(new Map());

  const stopCurrent = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      audioRef.current = null;
    }
  }, []);

  const speak = useCallback(
    (text: string, key: string) => {
      const gen = ++genRef.current;
      stopCurrent();
      setStatus('loading');

      const playUrl = (url: string) => {
        if (gen !== genRef.current) return; // step moved on while we waited
        const { audio, done } = play(url);
        audioRef.current = audio;
        setStatus('speaking');
        done
          .then(() => {
            if (gen === genRef.current) {
              audioRef.current = null;
              setStatus('idle');
            }
          })
          .catch((err) => {
            silentCatch('tour:narration:play')(err);
            if (gen === genRef.current) {
              audioRef.current = null;
              setStatus('error');
            }
          });
      };

      const cached = urlCacheRef.current.get(key);
      if (cached) {
        playUrl(cached);
        return;
      }

      const credentialId =
        voice.engine === 'elevenlabs' ? voice.credentialId : null;
      const voiceId =
        voice.engine === 'elevenlabs' ? voice.elevenVoiceId : voice.piperVoiceId;
      if (!voiceId) {
        setStatus('idle');
        return;
      }

      synthesize(text, credentialId, voiceId, settings, voice.engine)
        .then((url) => {
          urlCacheRef.current.set(key, url);
          playUrl(url);
        })
        .catch((err) => {
          silentCatch('tour:narration:synth')(err);
          if (gen === genRef.current) setStatus('error');
        });
    },
    [
      stopCurrent,
      settings,
      voice.engine,
      voice.credentialId,
      voice.elevenVoiceId,
      voice.piperVoiceId,
    ],
  );

  // Auto-speak once per step activation, when conditions allow.
  useEffect(() => {
    if (!active || !available || muted || !stepId || !narration) {
      // Stop any in-flight speech the moment narration should be silent
      // (step left, tour closed/minimized, or user muted mid-sentence).
      stopCurrent();
      genRef.current++; // invalidate any pending synth
      setStatus('idle');
      return;
    }
    speak(narration, stepId);
    // We intentionally key on stepId (not narration) so the same text on a
    // re-render doesn't re-trigger; `speak` is stable across voice config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, available, muted, stepId]);

  // Hard stop on unmount.
  useEffect(() => () => {
    stopCurrent();
    genRef.current++;
  }, [stopCurrent]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (next) {
        stopCurrent();
        genRef.current++;
        setStatus('idle');
      }
      return next;
    });
  }, [stopCurrent]);

  const replay = useCallback(() => {
    if (!available || !stepId || !narration) return;
    speak(narration, stepId);
  }, [available, stepId, narration, speak]);

  return { available, status, muted, toggleMute, replay };
}

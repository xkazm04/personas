import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, extractMessage } from '@/lib/silentCatch';
import type { TtsSettings } from '@/api/companion';
import { synthesize, play } from './voicePlayback';
import type { ResolvedTtsVoice } from './useTtsVoiceSelection';

import Button from '@/features/shared/components/buttons/Button';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
/**
 * On-demand read-aloud affordance below the latest completed assistant
 * bubble. Renders only when voice is configured for the user's chosen
 * engine (resolved upstream via `useTtsVoiceSelection` and passed in as
 * `voice` — ElevenLabs needs a credential + voice id; the local engines
 * need their own voice id; otherwise we'd hit the backend just to error).
 *
 * Local state machine:
 *   idle → synthesizing (await companion_tts) → playing (driving an
 *   HTMLAudioElement to completion) → idle (replay-ready) | error
 *   The "Stop" affordance during playing pauses the active audio.
 *
 * Independent of the main TTS pipeline (which fires automatically when
 * the panel has voiceEnabled). This is for "I want to hear what Athena
 * just said, but I didn't have voice on" — the on-demand path.
 */
export function BubbleReadAloud({
  content,
  voice,
  voiceSettings,
}: {
  content: string;
  voice: ResolvedTtsVoice;
  voiceSettings: TtsSettings | undefined;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<
    'idle' | 'synthesizing' | 'playing' | { kind: 'error'; message: string }
  >('idle');
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // Cleanup on unmount: stop any in-flight playback + revoke the
    // synthesized blob URL so the browser releases the audio bytes.
    return () => {
      activeAudioRef.current?.pause();
      activeAudioRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Skip rendering entirely when the selected engine isn't configured — a
  // tooltip "configure voice first" would be friendlier but takes a real
  // config UX cycle.
  if (!voice.configured || !content.trim()) return null;

  const handlePlay = async () => {
    if (state !== 'idle' && !(typeof state === 'object' && state.kind === 'error')) {
      return;
    }
    setState('synthesizing');
    try {
      const url = await synthesize(
        content,
        voice.credentialId,
        voice.voiceId ?? '',
        voiceSettings,
        voice.engine,
      );
      objectUrlRef.current = url;
      const { audio, done } = play(url);
      activeAudioRef.current = audio;
      setState('playing');
      try {
        await done;
      } catch (err) {
        // Playback aborted (user clicked Stop, or browser rejected mid-
        // play). Treat as "back to idle" rather than an error — the
        // user just chose to stop and shouldn't see a red chip.
        silentCatch('bubble_read_aloud_play')(err);
      }
      activeAudioRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setState('idle');
    } catch (err: unknown) {
      const message = extractMessage(err);
      setState({ kind: 'error', message });
      silentCatch('bubble_read_aloud_synthesize')(err);
    }
  };

  const handleStop = () => {
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setState('idle');
  };

  if (state === 'synthesizing') {
    return (
      <Button
        type="button"
        disabled
        key="synth"
        data-testid="companion-read-aloud-synthesizing"
        variant="secondary"
        size="sm"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{t.athena.read_aloud_synthesizing}</span>
      </Button>
    );
  }

  if (state === 'playing') {
    return (
      <Button
        type="button"
        onClick={handleStop}
        key="playing"
        data-testid="companion-read-aloud-playing"
        tooltip={t.athena.read_aloud_stop}
        aria-label={t.athena.read_aloud_stop}
        variant="secondary"
        size="sm"
      >
        <VolumeX className="w-3 h-3" />
        <span>{t.athena.read_aloud_stop}</span>
      </Button>
    );
  }

  if (typeof state === 'object' && state.kind === 'error') {
    return (
      <Tooltip content={state.message}>
        <span
          className="inline-flex items-center gap-1 rounded-interactive border border-status-error/30 bg-status-error/10 px-2 py-0.5 typo-caption text-status-error"
          data-testid="companion-read-aloud-error"
        >
          <AlertCircle className="w-3 h-3" />
          <span>{t.athena.read_aloud_failed}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <Button
      type="button"
      onClick={handlePlay}
      key="idle"
      data-testid="companion-read-aloud"
      tooltip={t.athena.read_aloud}
      aria-label={t.athena.read_aloud}
      variant="secondary"
      size="sm"
    >
      <Volume2 className="w-3 h-3" />
      <span>{t.athena.read_aloud}</span>
    </Button>
  );
}

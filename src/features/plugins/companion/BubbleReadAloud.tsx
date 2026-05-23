import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { TtsEngineId, TtsSettings } from '@/api/companion';
import { synthesize, play } from './voicePlayback';

/**
 * On-demand read-aloud affordance below the latest completed assistant
 * bubble. Renders only when voice is configured for the user's chosen
 * engine (ElevenLabs needs a credential + voice id; Piper needs a piper
 * voice id; otherwise we'd hit the backend just to surface an error).
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
  voiceEngine,
  voiceCredentialId,
  voiceId,
  piperVoiceId,
  voiceSettings,
}: {
  content: string;
  voiceEngine: TtsEngineId;
  voiceCredentialId: string | null;
  voiceId: string | null;
  piperVoiceId: string | null;
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

  // Both engines need at least one identity field set. Skip rendering
  // entirely when nothing's configured — a tooltip "configure voice
  // first" would be friendlier but takes a real config UX cycle.
  const configured =
    voiceEngine === 'elevenlabs'
      ? !!voiceCredentialId && !!voiceId
      : !!piperVoiceId;
  if (!configured || !content.trim()) return null;

  const handlePlay = async () => {
    if (state !== 'idle' && !(typeof state === 'object' && state.kind === 'error')) {
      return;
    }
    setState('synthesizing');
    try {
      const targetVoiceId =
        voiceEngine === 'elevenlabs' ? (voiceId ?? '') : (piperVoiceId ?? '');
      const url = await synthesize(
        content,
        voiceCredentialId,
        targetVoiceId,
        voiceSettings,
        voiceEngine,
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
      const message = err instanceof Error ? err.message : String(err);
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
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1 rounded-interactive border border-foreground/15 bg-foreground/[0.04] px-2 py-0.5 typo-caption text-foreground opacity-70"
        data-testid="companion-read-aloud-synthesizing"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{t.plugins.companion.read_aloud_synthesizing}</span>
      </button>
    );
  }

  if (state === 'playing') {
    return (
      <button
        type="button"
        onClick={handleStop}
        className="inline-flex items-center gap-1 rounded-interactive border border-primary/30 bg-primary/[0.08] hover:bg-primary/[0.12] px-2 py-0.5 typo-caption text-primary transition-colors focus-ring"
        data-testid="companion-read-aloud-playing"
        title={t.plugins.companion.read_aloud_stop}
        aria-label={t.plugins.companion.read_aloud_stop}
      >
        <VolumeX className="w-3 h-3" />
        <span>{t.plugins.companion.read_aloud_stop}</span>
      </button>
    );
  }

  if (typeof state === 'object' && state.kind === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-interactive border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 typo-caption text-rose-300/90"
        data-testid="companion-read-aloud-error"
        title={state.message}
      >
        <AlertCircle className="w-3 h-3" />
        <span>{t.plugins.companion.read_aloud_failed}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handlePlay}
      className="inline-flex items-center gap-1 rounded-interactive border border-foreground/15 bg-foreground/[0.04] hover:bg-foreground/[0.08] px-2 py-0.5 typo-caption text-foreground transition-colors focus-ring"
      data-testid="companion-read-aloud"
      title={t.plugins.companion.read_aloud}
      aria-label={t.plugins.companion.read_aloud}
    >
      <Volume2 className="w-3 h-3" />
      <span>{t.plugins.companion.read_aloud}</span>
    </button>
  );
}

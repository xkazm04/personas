import { useEffect, useRef } from 'react';
import { Bot, Play } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from './companionStore';
import { useSystemStore } from '@/stores/systemStore';
import { companionInit } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { playReplyChime } from './chime';
import { play as playAudio, synthesize as synthesizeTts } from './voicePlayback';
import { useTtsSettings } from './useTtsSettings';

/**
 * Athena's footer cluster. Lives in DesktopFooter's left cluster.
 *
 * Two-button structure:
 *   1. Bot icon — opens/collapses the chat panel.
 *   2. Play icon — plays the latest spoken summary if there's an unread
 *      one. Hidden when the user has no ElevenLabs credential configured
 *      (the feature isn't reachable, so the button would be confusing).
 *      Greyed when there's nothing to play; pulses gently while the user
 *      has an unread playback waiting so it draws the eye without
 *      auto-firing audio (browser autoplay policy + user agency).
 *
 * Responsibilities:
 *   - Fire `companion_init` once on first mount (idempotent backend-side).
 *   - Reflect Athena's streaming state on the bot icon: when a turn is in
 *     flight, the icon picks up `text-primary` and pulses softly.
 *   - Play a subtle two-note chime when streaming flips false (a turn
 *     just finished, regardless of whether the panel is open).
 */
export default function CompanionFooterIcon() {
  const { t } = useTranslation();
  const state = useCompanionStore((s) => s.state);
  const setState = useCompanionStore((s) => s.setState);
  const initialized = useCompanionStore((s) => s.initialized);
  const setInitialized = useCompanionStore((s) => s.setInitialized);
  const setBrainPath = useCompanionStore((s) => s.setBrainPath);
  const setInitError = useCompanionStore((s) => s.setInitError);
  const streaming = useCompanionStore((s) => s.streaming);
  const pendingPlayback = useCompanionStore((s) => s.pendingPlayback);
  const setPlaybackAudioUrl = useCompanionStore((s) => s.setPlaybackAudioUrl);
  const markPlaybackPlayed = useCompanionStore((s) => s.markPlaybackPlayed);
  const footerEnabled = useSystemStore((s) => s.companionFooterEnabled);
  const soundEnabled = useSystemStore((s) => s.companionSoundEnabled);
  const voiceEngine = useSystemStore((s) => s.companionVoiceEngine);
  const voiceCredentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const piperVoiceId = useSystemStore((s) => s.companionPiperVoiceId);
  const voiceSettings = useTtsSettings();

  useEffect(() => {
    if (initialized) return;
    void companionInit()
      .then((path) => {
        setBrainPath(path);
        setInitialized(true);
      })
      .catch((err: unknown) => {
        setInitError(err instanceof Error ? err.message : String(err));
        silentCatch('companion_init')(err);
      });
  }, [initialized, setBrainPath, setInitialized, setInitError]);

  // Chime on streaming true → false transition (turn just completed).
  // Skip the very first render's transition (the ref starts as
  // `undefined`, so we only fire after we've actually observed a true
  // value at least once). Respects the user's sound toggle.
  const prevStreamingRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevStreamingRef.current;
    if (prev === true && streaming === false && soundEnabled) {
      playReplyChime();
    }
    prevStreamingRef.current = streaming;
  }, [streaming, soundEnabled]);

  // Hide the footer entirely when the user disabled it via the
  // plugin's Setup tab. Returning null (rather than visibility:hidden)
  // also collapses the layout slot — the other footer icons close ranks.
  if (!footerEnabled) return null;

  const isOpen = state === 'open';
  // Per-engine readiness check — same shape as CompanionPanel's
  // `voiceActive` predicate. Piper needs only a voice id (engine binary
  // missing-ness surfaces at synth time); ElevenLabs needs both the
  // credential and the voice id.
  const voiceConfigured =
    voiceEngine === 'piper'
      ? Boolean(piperVoiceId)
      : Boolean(voiceCredentialId && voiceId);
  const synthesisCredentialId = voiceEngine === 'piper' ? null : voiceCredentialId;
  const synthesisVoiceId = voiceEngine === 'piper' ? piperVoiceId : voiceId;
  const hasUnreadPlayback =
    pendingPlayback != null && !pendingPlayback.played;

  // Color/animation when streaming. When the panel's open AND streaming,
  // the panel itself shows the streaming bubble — but we still color the
  // footer icon so the cue is reachable from anywhere in the app.
  const iconClass = streaming
    ? 'w-5 h-5 text-primary animate-pulse'
    : 'w-5 h-5';
  const buttonStateClass = isOpen
    ? 'bg-primary/15 text-primary'
    : streaming
      ? 'text-primary hover:bg-primary/10'
      : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50';

  const onPlay = async () => {
    if (!pendingPlayback || !synthesisVoiceId) return;
    try {
      // Reuse the cached blob URL when available — replays don't re-hit
      // the engine. First play falls through synthesize to populate it.
      const url =
        pendingPlayback.audioUrl ??
        (await synthesizeTts(
          pendingPlayback.ttsText,
          synthesisCredentialId,
          synthesisVoiceId,
          voiceSettings,
          voiceEngine,
        ));
      if (!pendingPlayback.audioUrl) setPlaybackAudioUrl(url);
      const { done } = playAudio(url);
      done
        .then(() => markPlaybackPlayed())
        .catch(silentCatch('companion_tts_play'));
    } catch (err) {
      silentCatch('companion_tts_play_footer')(err);
    }
  };

  return (
    <div className="inline-flex items-center gap-0.5">
      <button
        onClick={() => setState(isOpen ? 'collapsed' : 'open')}
        data-testid="footer-companion"
        className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition-colors focus-ring ${buttonStateClass}`}
        title={t.plugins.companion.open_label}
        aria-label={t.plugins.companion.open_label}
        aria-pressed={isOpen}
      >
        <Bot className={iconClass} />
      </button>
      {voiceConfigured && (
        <button
          onClick={onPlay}
          disabled={!hasUnreadPlayback}
          data-testid="footer-companion-play"
          className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition-colors focus-ring disabled:opacity-30 disabled:cursor-not-allowed ${
            hasUnreadPlayback
              ? 'text-primary hover:bg-primary/10 animate-pulse'
              : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50'
          }`}
          title={
            hasUnreadPlayback
              ? t.plugins.companion.play_latest
              : t.plugins.companion.play_nothing
          }
          aria-label={
            hasUnreadPlayback
              ? t.plugins.companion.play_latest
              : t.plugins.companion.play_nothing
          }
        >
          <Play className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

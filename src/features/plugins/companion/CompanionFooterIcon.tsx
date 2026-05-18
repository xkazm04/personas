import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Play, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from './companionStore';
import { useSystemStore } from '@/stores/systemStore';
import { companionInit } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { playReplyChime } from './chime';
import { play as playAudio, synthesize as synthesizeTts } from './voicePlayback';
import { useTtsSettings } from './useTtsSettings';

/**
 * Athena's footer cluster. Lives in DesktopFooter's right cluster.
 *
 * Two-button structure plus a notice popover:
 *   1. Bot icon — opens/collapses the chat panel. Pulses + recolors when
 *      Athena is streaming and again when a notice is pending so the
 *      arrival is glanceable from anywhere in the app.
 *   2. Play icon — plays the latest spoken summary if there's an unread
 *      one. Hidden when the user has no voice engine configured. Greyed
 *      when there's nothing to play; pulses gently while there's an
 *      unread playback waiting (user agency over autoplay).
 *   3. Popover — "Analysis completed" / "Athena reached out" subject
 *      shown above the icon when a `footerNotice` lands. Auto-dismisses
 *      after 6s, on click, or when the panel opens. If voice is enabled,
 *      the subject is also spoken once (guarded so it does not collide
 *      with the full reply playback already in flight).
 *
 * Responsibilities:
 *   - Fire `companion_init` once on first mount (idempotent backend-side).
 *   - Reflect Athena's streaming state on the bot icon.
 *   - Play the chime AND set `footerNotice` to `analysis_complete` when
 *     streaming flips false (a turn just finished).
 *   - Watch `proactive` arrivals and set `footerNotice` to `proactive`.
 *   - Render the popover + drive optional subject TTS.
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
  const proactive = useCompanionStore((s) => s.proactive);
  const footerNotice = useCompanionStore((s) => s.footerNotice);
  const setFooterNotice = useCompanionStore((s) => s.setFooterNotice);
  const markFooterNoticeSpoken = useCompanionStore((s) => s.markFooterNoticeSpoken);
  const clearFooterNotice = useCompanionStore((s) => s.clearFooterNotice);
  const footerEnabled = useSystemStore((s) => s.companionFooterEnabled);
  const soundEnabled = useSystemStore((s) => s.companionSoundEnabled);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
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
  const replyPlaybackInFlight =
    pendingPlayback != null && !pendingPlayback.played;

  // Chime + notice on streaming true → false transition (turn just
  // completed). Skip the very first render's transition (the ref starts
  // as `undefined`, so we only fire after we've actually observed a true
  // value at least once). Respects the user's sound toggle for the chime;
  // the popover always shows so the user has a visible cue independent
  // of the audio toggle.
  const prevStreamingRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevStreamingRef.current;
    if (prev === true && streaming === false) {
      if (soundEnabled) playReplyChime();
      setFooterNotice({
        id: `analysis_${Date.now()}`,
        kind: 'analysis_complete',
        subject: t.plugins.companion.footer_notice_analysis_completed,
        ttsSpoken: false,
        createdAt: Date.now(),
      });
    }
    prevStreamingRef.current = streaming;
  }, [streaming, soundEnabled, setFooterNotice, t]);

  // Proactive arrivals — surface the freshest one as a popover. We
  // track the latest seen id so reordering / list refetches do not
  // re-trigger the popover for messages the user already saw.
  const lastProactiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Newest proactive is at index 0 (appendProactive prepends).
    const latest = proactive[0];
    if (!latest) {
      lastProactiveIdRef.current = null;
      return;
    }
    if (lastProactiveIdRef.current === latest.id) return;
    // Skip the first observed id when we already have a populated list
    // (e.g., the panel hydrated on mount with historical unresolved
    // nudges — those were not "just delivered").
    if (lastProactiveIdRef.current === null && proactive.length > 0) {
      lastProactiveIdRef.current = latest.id;
      return;
    }
    lastProactiveIdRef.current = latest.id;
    // First sentence of the message as the subject — falls back to the
    // generic label when the message is empty.
    const firstSentence = latest.message?.split(/(?<=[.!?])\s/)[0]?.trim();
    const subject =
      firstSentence && firstSentence.length > 0
        ? firstSentence.length > 80
          ? `${firstSentence.slice(0, 77)}…`
          : firstSentence
        : t.plugins.companion.footer_notice_proactive_default;
    setFooterNotice({
      id: latest.id,
      kind: 'proactive',
      subject,
      ttsSpoken: false,
      createdAt: Date.now(),
    });
  }, [proactive, setFooterNotice, t]);

  // Auto-dismiss the popover after 6 seconds. Resets every time the
  // notice id changes. Cleared synchronously when the panel opens.
  useEffect(() => {
    if (!footerNotice) return;
    const timer = window.setTimeout(() => {
      // Re-check inside the timer — a fresh notice may have replaced
      // this one already, in which case we should not clear.
      const current = useCompanionStore.getState().footerNotice;
      if (current?.id === footerNotice.id) clearFooterNotice();
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [footerNotice, clearFooterNotice]);

  // Hide the popover when the panel opens — the user has already
  // engaged, no need to keep the cue around.
  useEffect(() => {
    if (isOpen && footerNotice) clearFooterNotice();
  }, [isOpen, footerNotice, clearFooterNotice]);

  // Speak the subject when voice is enabled and the engine is ready.
  // Skip when a full-reply TTS is already in flight (the reply
  // playback already gives the user the audible cue, and double-playing
  // a one-liner over a longer summary just garbles both).
  useEffect(() => {
    if (!footerNotice || footerNotice.ttsSpoken) return;
    if (!voiceEnabled || !voiceConfigured || !synthesisVoiceId) return;
    // Streaming-finish path: the reply's full TTS will play right after
    // this effect runs (CompanionPanel.send synthesizes + plays it).
    // Suppress the subject TTS so they don't overlap.
    if (
      footerNotice.kind === 'analysis_complete' &&
      replyPlaybackInFlight
    ) {
      markFooterNoticeSpoken();
      return;
    }
    let cancelled = false;
    markFooterNoticeSpoken();
    synthesizeTts(
      footerNotice.subject,
      synthesisCredentialId,
      synthesisVoiceId,
      voiceSettings,
      voiceEngine,
    )
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        const { done } = playAudio(url);
        done
          .catch(silentCatch('companion_footer_notice_tts_play'))
          .finally(() => URL.revokeObjectURL(url));
      })
      .catch(silentCatch('companion_footer_notice_tts_synthesize'));
    return () => {
      cancelled = true;
    };
  }, [
    footerNotice,
    voiceEnabled,
    voiceConfigured,
    synthesisCredentialId,
    synthesisVoiceId,
    voiceSettings,
    voiceEngine,
    replyPlaybackInFlight,
    markFooterNoticeSpoken,
  ]);

  // Hide the footer entirely when the user disabled it via the
  // plugin's Setup tab. Returning null (rather than visibility:hidden)
  // also collapses the layout slot — the other footer icons close ranks.
  if (!footerEnabled) return null;

  // Color/animation when streaming OR when there's a pending notice.
  // When the panel's open AND streaming, the panel itself shows the
  // streaming bubble — but we still color the footer icon so the cue
  // is reachable from anywhere in the app.
  const hasNotice = footerNotice != null;
  const iconClass = streaming || hasNotice
    ? 'w-5 h-5 text-primary animate-pulse'
    : 'w-5 h-5';
  const buttonStateClass = isOpen
    ? 'bg-primary/15 text-primary'
    : streaming || hasNotice
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
    <div className="relative inline-flex items-center gap-0.5">
      <AnimatePresence>
        {footerNotice && (
          <motion.button
            key={footerNotice.id}
            type="button"
            onClick={() => clearFooterNotice()}
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            data-testid="footer-companion-notice"
            data-companion-notice-kind={footerNotice.kind}
            className="absolute bottom-full right-0 mb-2 inline-flex items-center gap-2 max-w-[320px] px-3 py-1.5 rounded-card border border-primary/30 bg-background shadow-elevation-3 text-left focus-ring hover:bg-secondary/60 transition-colors z-50"
            title={t.plugins.companion.footer_notice_dismiss}
            aria-label={`${footerNotice.subject} — ${t.plugins.companion.footer_notice_dismiss}`}
          >
            <span className="typo-caption text-foreground/90 truncate">
              {footerNotice.subject}
            </span>
            <X className="w-3 h-3 flex-shrink-0 text-foreground/50" />
          </motion.button>
        )}
      </AnimatePresence>
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

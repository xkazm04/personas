import { useEffect, useRef, useCallback } from 'react';
import { Play, Mic } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from './companionStore';
import { useSystemStore } from '@/stores/systemStore';
import { companionInit } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { playReplyChime } from './chime';
import { play as playAudio, synthesize as synthesizeTts } from './voicePlayback';
import { useTtsSettings } from './useTtsSettings';
import { useTtsVoiceSelection } from './useTtsVoiceSelection';
import { AthenaAvatar, type AthenaState } from './AthenaAvatar';
import { useHoldToTalk } from './useHoldToTalk';
import { useConversationRoster, useThreadAttentionCount } from './useConversationRoster';

/**
 * Athena's footer cluster. Lives in DesktopFooter's right cluster.
 *
 * Two buttons, no message surface. Athena speaks on exactly two dimensions —
 * the CHAT window (full information) and the ORB (quick info / decision). The
 * footer cluster is an *initiation* surface, not a third dimension: it once
 * hosted a notice popover ("Analysis completed", "Athena reached out") that was
 * removed with the rest of the third dimension. A finished reply now shows up
 * as ORB STATE only (the orb's one-shot message reaction + `speaking` posture,
 * plus the avatar/Play affordances below), and the words themselves live in
 * chat where the user can actually read them.
 *
 *   1. Athena avatar — her live video avatar (idle ⇄ thinking ⇄ speaking)
 *      is the initiation surface. A short tap opens/collapses the chat
 *      panel (or summons/hides the orb); a press-and-hold arms dictation and
 *      fires a voice turn through Athena's full pipeline without opening the
 *      panel (the reply surfaces via the orb, the Play button, and TTS).
 *      Recolors/pulses while she streams and while the mic is armed. Carries
 *      the multi-thread attention badge.
 *   2. Play icon — plays the latest spoken summary if there's an unread
 *      one. Hidden when the user has no voice engine configured. Greyed
 *      when there's nothing to play; pulses gently while there's an
 *      unread playback waiting (user agency over autoplay).
 *
 * Responsibilities:
 *   - Fire `companion_init` once on first mount (idempotent backend-side).
 *   - Reflect Athena's streaming/speaking state on the avatar.
 *   - Drive hold-to-talk dictation → `voiceTurnRequest` (consumed by the
 *     always-mounted CompanionPanel's `send()` pipeline).
 *   - Play the reply chime when streaming flips false (a turn just finished).
 */
export default function CompanionFooterIcon() {
  const { t } = useTranslation();
  // Keep the multi-conversation roster live (hydrate + refresh on turn-summary)
  // from here, since the footer orb is always mounted — the chat panel isn't.
  useConversationRoster();
  const attentionCount = useThreadAttentionCount();
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
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const soundEnabled = useSystemStore((s) => s.companionSoundEnabled);
  const voice = useTtsVoiceSelection();
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

  // Per-engine readiness check — resolved upstream by `useTtsVoiceSelection`
  // (same predicate CompanionPanel's `voiceActive` uses).
  const voiceConfigured = voice.configured;
  const synthesisCredentialId = voice.credentialId;
  const synthesisVoiceId = voice.voiceId;
  const hasUnreadPlayback =
    pendingPlayback != null && !pendingPlayback.played;

  // Chime on the streaming true → false transition (turn just completed).
  // Skip the very first render's transition (the ref starts as `undefined`, so
  // we only fire after we've actually observed a true value at least once).
  // Respects the user's sound toggle.
  //
  // This used to ALSO mint a `footerNotice` popover naming the thread. That was
  // the third communication dimension and is gone: the visible cue is now ORB
  // STATE (the orb plays its one-shot message reaction off the same `streaming`
  // transition and flips to the `speaking` posture while an unread spoken reply
  // waits), the audible cue is the chime plus the reply's own TTS, and the words
  // live in chat. The Play button + the thread-attention badge below carry the
  // "there is something unheard / another thread replied" state.
  const prevStreamingRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevStreamingRef.current;
    if (prev === true && streaming === false && soundEnabled) playReplyChime();
    prevStreamingRef.current = streaming;
  }, [streaming, soundEnabled]);

  // ---------------------------------------------------------------------
  // Hold-to-talk: press-and-hold the avatar to dictate a message and fire
  // a voice turn through Athena's full pipeline WITHOUT opening the panel.
  // A short tap keeps the original behaviour (toggle the chat panel).
  //
  // STT here is the browser Web Speech engine (`useDictation`). On
  // WebView2 that forwards audio to the OS vendor's cloud STT — the local
  // Whisper engine that keeps audio on-device is the separate workstream
  // in docs/features/companion/athena-orb-overlay-plan.md §4. The mic is
  // only ever armed by an explicit press, never on mount.
  // ---------------------------------------------------------------------
  const { supported: sttSupported, talking, start: startTalk, stop: stopTalk } =
    useHoldToTalk();
  const HOLD_MS = 220;
  const holdTimerRef = useRef<number | null>(null);
  // A hold ends in a `click` (pointerup → click); suppress that synthetic
  // click so releasing a hold doesn't also toggle the panel open.
  const suppressClickRef = useRef(false);

  const beginHold = useCallback(() => {
    if (!sttSupported || holdTimerRef.current != null) return;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      suppressClickRef.current = true;
      startTalk();
    }, HOLD_MS);
  }, [sttSupported, startTalk]);

  const endHold = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    stopTalk();
  }, [stopTalk]);

  // Clear any pending hold timer on unmount.
  useEffect(() => {
    return () => {
      if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
    };
  }, []);

  // Hide the footer entirely when the user disabled it via the
  // plugin's Setup tab. Returning null (rather than visibility:hidden)
  // also collapses the layout slot — the other footer icons close ranks.
  if (!footerEnabled) return null;

  // Color/animation when streaming. When the panel's open AND streaming, the
  // panel itself shows the streaming bubble — but we still color the footer
  // icon so the cue is reachable from anywhere in the app.
  // Athena's avatar reflects what she's doing: thinking while she streams
  // (or while the user is dictating), speaking while an unread spoken
  // summary is waiting, idle otherwise.
  const avatarState: AthenaState = talking || streaming
    ? 'thinking'
    : hasUnreadPlayback
      ? 'speaking'
      : 'idle';
  const buttonStateClass = talking
    ? 'bg-primary/20 ring-2 ring-primary/50'
    : isOpen
      ? 'bg-primary/15'
      : streaming
        ? 'hover:bg-primary/10'
        : 'hover:bg-secondary/50';

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
          voice.engine,
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
      <button
        type="button"
        onClick={() => {
          // A hold ends in a synthetic click — swallow it so releasing a
          // dictation hold doesn't also toggle anything.
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          // With the floating orb enabled, the footer button summons/hides
          // the orb (minimized ↔ collapsed); the orb itself opens the full
          // chat. Without the orb, tap toggles the chat panel directly.
          if (orbEnabled) {
            setState(state === 'minimized' ? 'collapsed' : 'minimized');
          } else {
            setState(isOpen ? 'collapsed' : 'open');
          }
        }}
        onPointerDown={beginHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        data-testid="footer-companion"
        className={`relative w-7 h-7 rounded-card flex items-center justify-center transition-colors focus-ring ${buttonStateClass} ${talking ? 'animate-pulse' : ''}`}
        title={
          talking
            ? t.plugins.companion.footer_listening
            : sttSupported
              ? t.plugins.companion.footer_hold_to_talk
              : t.plugins.companion.open_label
        }
        aria-label={
          talking
            ? t.plugins.companion.footer_listening
            : sttSupported
              ? t.plugins.companion.footer_hold_to_talk
              : t.plugins.companion.open_label
        }
        aria-pressed={isOpen}
      >
        <AthenaAvatar state={avatarState} size={20} />
        {talking && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary flex items-center justify-center ring-1 ring-background">
            <Mic className="w-2 h-2 text-background" />
          </span>
        )}
        {/* Multi-conversation: how many OTHER threads are awaiting the user.
            Top-right, so it never collides with the talking mic (bottom-right). */}
        {attentionCount > 0 && (
          <span
            data-testid="companion-thread-attention"
            className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-status-success text-background typo-caption font-semibold inline-flex items-center justify-center ring-1 ring-background tabular-nums"
            aria-label={`${attentionCount} ${t.plugins.companion.thread_status_awaiting}`}
          >
            {attentionCount}
          </span>
        )}
      </button>
      {voiceConfigured && (
        <button
          type="button"
          onClick={onPlay}
          disabled={!hasUnreadPlayback}
          data-testid="footer-companion-play"
          className={`relative w-7 h-7 rounded-card flex items-center justify-center transition-colors focus-ring disabled:opacity-30 disabled:cursor-not-allowed ${
            hasUnreadPlayback
              ? 'text-primary hover:bg-primary/10 animate-pulse'
              : 'text-foreground hover:text-foreground hover:bg-secondary/50'
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

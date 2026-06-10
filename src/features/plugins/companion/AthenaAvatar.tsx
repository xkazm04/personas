import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { silentCatch } from '@/lib/silentCatch';


/**
 * Athena's video avatar — stacked `<video>` elements that crossfade between
 * an idle loop and a thinking loop driven by `state`, plus a one-shot
 * `message` clip the orb fires when Athena's reply lands.
 *
 * **Loop-boundary swap discipline (idle ⇄ thinking).** Earlier iterations
 * let the crossfade fire mid-clip; the user saw "the video cuts in half"
 * because the thinking clip has a dramatic arc (calm → climax → calm via
 * ping-pong) and crossfading at frame 50/241 reveals a halo'd climax pose.
 * So idle↔thinking swaps only commit at a loop boundary (the active clip's
 * `ended`). `displayState` (what's visible) is tracked separately from
 * `state` (what the caller wants); a `state` change updates a ref and the
 * swap lands at frame 0 of both clips. The `message` one-shot is the
 * exception — it crossfades in *immediately* so the reaction feels prompt.
 *
 * Source files (`/public/athena/`, all 320×320 / 12fps / CRF 30 / no audio,
 * ping-pong so the end blends back to the start pose):
 *   - `athena_idle_loop.mp4`, `athena_thinking_loop.mp4`
 *   - `athena_message_loop.mp4` — one-shot reaction (raises arms and back).
 *
 * **Resource discipline.** These videos are a nice-to-have in a tiny space;
 * they must not burn CPU/GPU:
 *   - Only ONE clip plays at a time; the others are paused at frame 0.
 *   - Playback pauses whenever the document is hidden (tab/window in the
 *     background) and resumes on return — zero decode when unseen.
 *   - `prefers-reduced-motion` mounts NO `<video>` at all — just the static
 *     poster — so there's no decode for users who opt out (and no message
 *     reaction).
 *   - Hardware-decoded at orb/footer sizes the cost is a fraction of 1% CPU.
 */
export type AthenaState = 'idle' | 'thinking' | 'speaking' | 'composing';

/**
 * Which clip is actually rendered. `speaking` (part of {@link AthenaState})
 * has no dedicated clip yet, so it falls back to idle. `composing` (Athena
 * is preparing a visual explanation — the orb decision `0` flow) maps to
 * the `shows` presenting clip. `message` is never a sticky `state` — it's
 * driven only by the `messageNonce` one-shot.
 */
type ClipState = 'idle' | 'thinking' | 'message' | 'shows';

const CLIP_SRC: Record<ClipState, string> = {
  idle: '/athena/athena_idle_loop.mp4',
  thinking: '/athena/athena_thinking_loop.mp4',
  message: '/athena/athena_message_loop.mp4',
  shows: '/athena/athena_shows_loop.mp4',
};

const CLIP_ORDER: ClipState[] = ['idle', 'thinking', 'message', 'shows'];

function clipFor(state: AthenaState): ClipState {
  return state === 'speaking' ? 'idle' : state === 'composing' ? 'shows' : state;
}

export function AthenaAvatar({
  state,
  size = 36,
  fill = false,
  className,
  messageNonce,
  onMessageActiveChange,
}: {
  state: AthenaState;
  size?: number;
  /**
   * `fill=true` makes the avatar fill its (positioned) parent and skips
   * the circular crop/ring/background — used as a low-opacity watermark
   * behind the chat. `fill=false` (default) renders a small circular
   * avatar suitable for headers/inline use.
   */
  fill?: boolean;
  /** Extra classes (positioning, opacity overrides) for the outer wrapper. */
  className?: string;
  /**
   * Increment to fire the one-shot `message` clip: it crossfades in
   * immediately, plays one loop, then reverts to `state`. The orb bumps
   * this when Athena's reply lands. No-op under reduced motion.
   */
  messageNonce?: number;
  /** Fired `true` when the message clip starts, `false` after its one loop. */
  onMessageActiveChange?: (active: boolean) => void;
}) {
  const reduce = useReducedMotion() ?? false;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const idleRef = useRef<HTMLVideoElement>(null);
  const thinkingRef = useRef<HTMLVideoElement>(null);
  const messageRef = useRef<HTMLVideoElement>(null);
  const showsRef = useRef<HTMLVideoElement>(null);
  const refFor = useCallback((c: ClipState): HTMLVideoElement | null => {
    return c === 'idle'
      ? idleRef.current
      : c === 'thinking'
        ? thinkingRef.current
        : c === 'shows'
          ? showsRef.current
          : messageRef.current;
  }, []);

  // What the caller wants, narrowed to a sticky clip (idle/thinking).
  const pendingRef = useRef<ClipState>(clipFor(state));
  useEffect(() => {
    pendingRef.current = clipFor(state);
  }, [state]);

  // What's actually visible. Flips at a loop boundary for idle↔thinking, or
  // immediately for the message one-shot.
  const [displayState, setDisplayState] = useState<ClipState>(clipFor(state));

  /**
   * Drive the active/inactive split. The active clip plays from frame 0
   * (only while the document is visible); the others pause at frame 0 so
   * they're pre-rolled for the next swap.
   */
  const playActive = useCallback(
    (which: ClipState) => {
      for (const c of CLIP_ORDER) {
        const el = refFor(c);
        if (!el) continue;
        if (c === which) {
          el.currentTime = 0;
          // Autoplay can be blocked until a user gesture; tolerate rejection
          // silently. Don't start playback while the tab is hidden.
          if (!document.hidden) el.play().catch(() => {});
        } else {
          try {
            el.pause();
          } catch (err) {
            silentCatch('features/plugins/companion/AthenaAvatar:catch1')(err);
          }
          el.currentTime = 0;
        }
      }
    },
    [refFor],
  );

  useEffect(() => {
    if (!mounted || reduce) return;
    playActive(displayState);
  }, [mounted, reduce, displayState, playActive]);

  // Pause/resume the active clip with document visibility — no decode while
  // the app is backgrounded (the biggest resource win for an always-mounted
  // footer/orb video).
  useEffect(() => {
    if (reduce) return;
    const onVis = () => {
      const el = refFor(displayState);
      if (!el) return;
      if (document.hidden) {
        try {
          el.pause();
        } catch (err) {
          silentCatch('features/plugins/companion/AthenaAvatar:visibility')(err);
        }
      } else {
        el.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [reduce, displayState, refFor]);

  // One-shot message clip: crossfade in immediately on a fresh nonce, play
  // one loop, then `onEnded` reverts to the sticky state. Skipped under
  // reduced motion (no swap, no `onMessageActiveChange`).
  const prevNonceRef = useRef(messageNonce);
  useEffect(() => {
    if (reduce) return;
    if (messageNonce === undefined || messageNonce === prevNonceRef.current) return;
    prevNonceRef.current = messageNonce;
    onMessageActiveChange?.(true);
    setDisplayState('message');
  }, [messageNonce, reduce, onMessageActiveChange]);

  const onEnded = useCallback(
    (which: ClipState) => {
      // Hidden clip's `ended` is irrelevant — only act for the active one.
      if (which !== displayState) return;
      if (which === 'message') {
        // One loop done — hand the display back to the sticky state.
        onMessageActiveChange?.(false);
        setDisplayState(pendingRef.current);
        return;
      }
      const target = pendingRef.current;
      if (target !== displayState) {
        setDisplayState(target);
      } else {
        const el = refFor(which);
        if (el) {
          el.currentTime = 0;
          el.play().catch(() => {});
        }
      }
    },
    [displayState, refFor, onMessageActiveChange],
  );

  // Reduced motion: render the static poster only — no <video> mounts.
  const content = reduce ? (
    <img
      src="/athena/athena_baseline.jpg"
      alt=""
      className="absolute inset-0 w-full h-full object-cover"
    />
  ) : !mounted ? null : (
    <>
      {CLIP_ORDER.map((c) => (
        <video
          key={c}
          ref={
            c === 'idle'
              ? idleRef
              : c === 'thinking'
                ? thinkingRef
                : c === 'shows'
                  ? showsRef
                  : messageRef
          }
          src={CLIP_SRC[c]}
          // baseline.jpg matches the first frame of every clip, so the
          // still→video handoff is invisible while the browser decodes.
          poster="/athena/athena_baseline.jpg"
          muted
          playsInline
          preload="auto"
          onEnded={() => onEnded(c)}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ease-out"
          style={{ opacity: displayState === c ? 1 : 0 }}
        />
      ))}
    </>
  );

  if (fill) {
    return (
      <div className={`pointer-events-none ${className ?? ''}`} aria-hidden>
        {content}
      </div>
    );
  }

  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full overflow-hidden bg-primary/10 ring-1 ring-primary/20"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {content}
    </span>
  );
}

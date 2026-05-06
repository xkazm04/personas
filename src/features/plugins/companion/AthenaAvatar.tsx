import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Athena's video avatar — two stacked `<video>` elements that crossfade
 * between an idle loop and a thinking loop driven by `state`.
 *
 * **Loop-boundary swap discipline.** Earlier iterations let the
 * crossfade fire mid-clip; the user saw "the video cuts in half"
 * because the thinking clip has a dramatic arc (calm → climax → calm
 * via ping-pong) and crossfading at frame 50/241 reveals a halo'd
 * climax pose right as the panel is supposed to settle. We now:
 *
 * 1. Drop the `loop` attribute. Each video manually replays from
 *    frame 0 in its `onEnded` handler. This means `ended` actually
 *    fires (HTMLMediaElement suppresses `ended` while `loop=true`),
 *    giving us a deterministic "loop boundary" event.
 * 2. Track `displayState` (what's visible) separately from `state`
 *    (what the caller wants). `state` changes update a ref;
 *    `displayState` only flips on the active video's `ended` event.
 *    Result: the swap always lands at frame 0 of both clips, the
 *    crossfade is between two matching poses, and the user never
 *    sees a mid-arc cut.
 * 3. Inactive video is paused at frame 0. No background CPU; the
 *    incoming clip is always pre-rolled to a clean starting frame.
 *
 * Source files (`/public/athena/`):
 *   - `athena_idle_loop.mp4`    — 5s, audio stripped, clean loop
 *     (first frame ≈ last frame; ffmpeg re-encode of the original).
 *   - `athena_thinking_loop.mp4` — 10s ping-pong (forward + reverse
 *     concat), so the dramatic ending blends back into the calm
 *     starting pose without a hard cut.
 *
 * Performance:
 *   - Lazy mount: this component only renders while the panel is
 *     open (panel is `lazy()` in App.tsx). 50ms tick before mount
 *     so the open-animation isn't competing with video decode.
 *   - Single decode: each video element decodes its own clip once.
 *     At 80px square the cost is <1% CPU; the watermark `fill` mode
 *     stretches them but that's still a single hardware-accelerated
 *     decode.
 */
export type AthenaState = 'idle' | 'thinking';

export function AthenaAvatar({
  state,
  size = 36,
  fill = false,
  className,
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
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const idleRef = useRef<HTMLVideoElement>(null);
  const thinkingRef = useRef<HTMLVideoElement>(null);

  // What the caller wants. Captured via ref so the `onEnded` handler
  // (created once per render) sees the latest value without churn.
  const pendingRef = useRef<AthenaState>(state);
  useEffect(() => {
    pendingRef.current = state;
  }, [state]);

  // What's actually visible right now. Flips on the active video's
  // `ended` event; never mid-clip.
  const [displayState, setDisplayState] = useState<AthenaState>(state);

  /**
   * Drive the active/inactive split. The active clip plays from where
   * it is (or from frame 0 on a fresh swap); the inactive clip pauses
   * at frame 0 so it's pre-rolled for the next swap.
   */
  const playActive = useCallback((which: AthenaState) => {
    const active = which === 'idle' ? idleRef.current : thinkingRef.current;
    const inactive = which === 'idle' ? thinkingRef.current : idleRef.current;
    if (active) {
      active.currentTime = 0;
      // Autoplay can be blocked until the WebView gets a user gesture;
      // the panel-open click already provides one in normal flow, but
      // we tolerate a rejection silently — the next state change retries.
      active.play().catch(() => {});
    }
    if (inactive) {
      try {
        inactive.pause();
      } catch {
        /* not yet ready — fine */
      }
      inactive.currentTime = 0;
    }
  }, []);

  // Whenever the visible state changes (mount, or a swap committed by
  // onEnded), reset both videos to the active/inactive split.
  useEffect(() => {
    if (!mounted) return;
    playActive(displayState);
  }, [mounted, displayState, playActive]);

  /**
   * Active video finished a loop. Decision: swap to the requested
   * state if it differs from what we're showing, otherwise replay
   * the same clip from frame 0 (manual loop).
   */
  const onEnded = useCallback(
    (which: AthenaState) => {
      // Hidden clip's `ended` is irrelevant — only act for the active.
      if (which !== displayState) return;
      const target = pendingRef.current;
      if (target !== displayState) {
        // Commit the swap. The `displayState` effect above resets both
        // refs (active to currentTime=0+play, inactive to pause+0).
        setDisplayState(target);
      } else {
        // Same state — manual self-loop.
        const el = which === 'idle' ? idleRef.current : thinkingRef.current;
        if (el) {
          el.currentTime = 0;
          el.play().catch(() => {});
        }
      }
    },
    [displayState],
  );

  const videos = mounted ? (
    <>
      <video
        ref={idleRef}
        src="/athena/athena_idle_loop.mp4"
        // baseline.jpg matches the first frame of both clips, so the
        // still→video handoff is invisible while the browser decodes.
        poster="/athena/athena_baseline.jpg"
        muted
        playsInline
        preload="auto"
        onEnded={() => onEnded('idle')}
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ease-out"
        style={{ opacity: displayState === 'idle' ? 1 : 0 }}
      />
      <video
        ref={thinkingRef}
        src="/athena/athena_thinking_loop.mp4"
        poster="/athena/athena_baseline.jpg"
        muted
        playsInline
        preload="auto"
        onEnded={() => onEnded('thinking')}
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ease-out"
        style={{ opacity: displayState === 'thinking' ? 1 : 0 }}
      />
    </>
  ) : null;

  if (fill) {
    return (
      <div className={`pointer-events-none ${className ?? ''}`} aria-hidden>
        {videos}
      </div>
    );
  }

  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full overflow-hidden bg-primary/10 ring-1 ring-primary/20"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {videos}
    </span>
  );
}

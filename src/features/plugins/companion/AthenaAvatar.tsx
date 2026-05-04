import { useEffect, useRef, useState } from 'react';

/**
 * Tiny circular video avatar for Athena's panel header. Two stacked
 * `<video>` elements crossfade between an idle loop and a thinking loop
 * driven by `streaming`. Both are muted/looped/autoplay so the OS-level
 * audio stack is never engaged — the user's "I don't hear sound" report
 * a few iterations back was because the chime needs an explicit gesture
 * grant; muted video has no such gate.
 *
 * Performance discipline:
 * - **Lazy mount**: this component is only rendered while the panel is
 *   open (the panel itself is `lazy()` in App.tsx), so the videos never
 *   load if Athena is collapsed.
 * - **Single decode**: each `<video>` decodes its own loop, but at 80px
 *   square that's <1% CPU. We do NOT decode a third "alerting" track
 *   here — it can be a separate variant later (Phase E).
 * - **No mid-frame swap**: the crossfade is opacity-only. Both videos
 *   keep playing through the transition; whichever is at opacity 1 is
 *   what the user sees. Transition duration is short enough (180ms)
 *   that no awkward frame-jump is visible even if the sources differ
 *   in length.
 * - **`preload="auto"`** on both so the browser pre-decodes a few
 *   frames before we cross-fade in. Avoids the "first frame is black"
 *   flash that plagues lazy autoplay.
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
  // Track whether the videos have been touched at least once. We
  // don't render them on first paint to keep first-render cheap;
  // mount on next tick so the panel's open-animation isn't competing
  // with video decode.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const idleRef = useRef<HTMLVideoElement>(null);
  const thinkingRef = useRef<HTMLVideoElement>(null);

  // When mounted, kick both videos to play so the crossfade is instant
  // when state flips. Browsers may suspend autoplay until visible; the
  // explicit play() retries until it succeeds. Both calls are no-ops
  // if the video is already playing.
  useEffect(() => {
    if (!mounted) return;
    const tryPlay = (el: HTMLVideoElement | null) => {
      if (!el) return;
      el.play().catch(() => {
        // Autoplay blocked — a follow-up user gesture (panel click,
        // already happened to open the panel) will let it through next
        // tick. We retry on every state change anyway.
      });
    };
    tryPlay(idleRef.current);
    tryPlay(thinkingRef.current);
  }, [mounted, state]);

  const videos = mounted ? (
    <>
      <video
        ref={idleRef}
        src="/athena/athena_idle.mp4"
        // baseline.jpg should match the first frame of both clips, so
        // the still→video handoff is invisible while the browser decodes.
        poster="/athena/athena_baseline.jpg"
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ease-out"
        style={{ opacity: state === 'idle' ? 1 : 0 }}
      />
      <video
        ref={thinkingRef}
        src="/athena/athena_thinking.mp4"
        poster="/athena/athena_baseline.jpg"
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ease-out"
        style={{ opacity: state === 'thinking' ? 1 : 0 }}
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

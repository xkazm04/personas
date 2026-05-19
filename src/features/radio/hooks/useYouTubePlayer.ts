import { useEffect, useRef } from 'react';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Thin wrapper around the YouTube IFrame Player API. The host element
 * passed in is replaced by the player iframe at construction; callers
 * are responsible for sizing/positioning that host (this component
 * makes no styling assumptions — RadioFooter places it off-screen).
 *
 * The script tag is injected once globally; subsequent hook instances
 * reuse the cached `window.YT` namespace.
 */

interface YTPlayerCallbacks {
  onReady?: () => void;
  /** YT player state codes: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  onStateChange?: (stateCode: number) => void;
  /** YT error codes: 2 invalid param, 5 HTML5 player error, 100 not found, 101/150 embedding disabled. */
  onError?: (errorCode: number) => void;
}

export interface YTPlayerHandle {
  loadVideo: (videoId: string, opts?: { startSeconds?: number; autoplay?: boolean }) => void;
  play: () => void;
  pause: () => void;
  /** `volume` is in [0.0, 1.0]; we convert to YT's 0–100 scale internally. */
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  /**
   * Real duration of the currently loaded video, in seconds. Returns 0
   * before the player has fetched the video metadata (typical for the
   * first few hundred ms after `loadVideo`). Track-level `durationSec`
   * in the seed is null — this is how the renderer learns the real
   * length for the progress bar.
   */
  getDuration: () => number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
      PlayerState?: Record<string, number>;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let scriptLoadingPromise: Promise<void> | null = null;

function loadIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve();
  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => reject(new Error('failed to load YouTube IFrame API'));
      document.head.appendChild(tag);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } finally {
        resolve();
      }
    };
    // Safety net: if YT is already loaded by another caller before our
    // onYouTubeIframeAPIReady wired in, resolve directly.
    if (window.YT?.Player) resolve();
  });
  return scriptLoadingPromise;
}

/**
 * Mounts a YT.Player on `hostRef.current` once the IFrame API is loaded.
 * Returns a stable handle (via ref) that stays valid for the lifetime
 * of the host element. Re-rendering callbacks does NOT recreate the
 * player — the latest callbacks are read at fire time via a ref.
 */
export function useYouTubePlayer(
  hostRef: React.RefObject<HTMLDivElement | null>,
  callbacks: YTPlayerCallbacks,
): React.MutableRefObject<YTPlayerHandle | null> {
  const handleRef = useRef<YTPlayerHandle | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let cancelled = false;
    let rawPlayer: unknown = null;

    loadIframeApi()
      .then(() => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!host || !window.YT?.Player) return;

        rawPlayer = new window.YT.Player(host, {
          height: '200',
          width: '200',
          videoId: '',
          // Reduced-tracking embed host — strips ads/analytics scripts that
          // throw "Cannot read properties of undefined (reading 'plugins')"
          // inside Tauri's WebView2. CSP frame-src already allows it.
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => callbacksRef.current.onReady?.(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onStateChange: (e: any) => callbacksRef.current.onStateChange?.(Number(e?.data ?? -1)),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onError: (e: any) => callbacksRef.current.onError?.(Number(e?.data ?? 0)),
          },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = rawPlayer as any;
        handleRef.current = {
          loadVideo: (videoId, opts) => {
            try {
              if (opts?.autoplay === false) {
                p.cueVideoById?.({ videoId, startSeconds: opts?.startSeconds ?? 0 });
              } else {
                p.loadVideoById?.({ videoId, startSeconds: opts?.startSeconds ?? 0 });
              }
            } catch (e) { silentCatch('radio:yt-load')(e); }
          },
          play: () => { try { p.playVideo?.(); } catch (e) { silentCatch('radio:yt-play')(e); } },
          pause: () => { try { p.pauseVideo?.(); } catch (e) { silentCatch('radio:yt-pause')(e); } },
          setVolume: (volume) => {
            try {
              p.setVolume?.(Math.round(Math.max(0, Math.min(1, volume)) * 100));
            } catch (e) { silentCatch('radio:yt-volume')(e); }
          },
          getCurrentTime: () => {
            try { return Number(p.getCurrentTime?.() ?? 0); } catch (e) {
              silentCatch('radio:yt-current-time')(e);
              return 0;
            }
          },
          getDuration: () => {
            try { return Number(p.getDuration?.() ?? 0); } catch (e) {
              silentCatch('radio:yt-duration')(e);
              return 0;
            }
          },
        };
      })
      .catch(silentCatch('radio:yt-script-load'));

    return () => {
      cancelled = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rawPlayer as any)?.destroy?.();
      } catch (e) { silentCatch('radio:yt-destroy')(e); }
      handleRef.current = null;
    };
  }, [hostRef]);

  return handleRef;
}

import { useEffect, useRef } from 'react';

import { silentCatch } from '@/lib/silentCatch';

/**
 * Publishes the radio's transport to the OS through the Media Session API, so
 * headset buttons, keyboard media keys and the system now-playing overlay
 * drive the same `radio_*` commands the footer buttons do.
 *
 * Two rules the implementation is built around:
 *
 * - **One transport, many surfaces.** The handlers are registered once and
 *   read the latest callbacks through a ref, so a re-render never re-registers
 *   (and never leaves a stale closure calling last render's `radioPause`).
 * - **Absent is not disabled-looking.** A capability the current station does
 *   not have (prev/next on a live stream) is registered as `null`, which is
 *   how the Media Session API asks the OS to grey the control out — matching
 *   the footer's own `disabled` buttons rather than silently ignoring a press.
 */
export interface MediaSessionOptions {
  /** A station is loaded and not stopped. When false, everything is cleared. */
  active: boolean;
  /** Drives `playbackState` — the overlay's play/pause glyph. */
  playing: boolean;
  title: string;
  artist: string;
  album?: string;
  onPlay: () => void;
  onPause: () => void;
  /** `null` when the current station cannot skip (live streams). */
  onNext: (() => void) | null;
  onPrevious: (() => void) | null;
  onStop?: () => void;
}

type ActionName = 'play' | 'pause' | 'nexttrack' | 'previoustrack' | 'stop';
const ACTIONS: ActionName[] = ['play', 'pause', 'nexttrack', 'previoustrack', 'stop'];

function session(): MediaSession | null {
  if (typeof navigator === 'undefined') return null;
  const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
  return ms ?? null;
}

/** Older webviews expose `mediaSession` without the `MediaMetadata` ctor. */
function makeMetadata(init: MediaMetadataInit): MediaMetadata | null {
  if (typeof MediaMetadata === 'undefined') return null;
  return new MediaMetadata(init);
}

function setAction(ms: MediaSession, action: ActionName, handler: (() => void) | null): void {
  try {
    ms.setActionHandler(action, handler);
  } catch (err) {
    // An action this webview does not know throws on registration; the rest
    // must still be wired. Nothing is lost — the OS simply has no such button.
    silentCatch('radio:media-session:set-action')(err);
  }
}

export function useMediaSession(opts: MediaSessionOptions): void {
  const latest = useRef(opts);
  latest.current = opts;

  const { active, playing, title, artist, album } = opts;
  const canNext = opts.onNext !== null;
  const canPrevious = opts.onPrevious !== null;

  // Handlers: registered on activation, cleared on deactivation/unmount.
  useEffect(() => {
    const ms = session();
    if (!ms || !active) return;

    setAction(ms, 'play', () => latest.current.onPlay());
    setAction(ms, 'pause', () => latest.current.onPause());
    setAction(ms, 'nexttrack', canNext ? () => latest.current.onNext?.() : null);
    setAction(ms, 'previoustrack', canPrevious ? () => latest.current.onPrevious?.() : null);
    setAction(ms, 'stop', () => (latest.current.onStop ?? latest.current.onPause)());

    return () => {
      for (const action of ACTIONS) setAction(ms, action, null);
    };
  }, [active, canNext, canPrevious]);

  // Metadata + playback state.
  useEffect(() => {
    const ms = session();
    if (!ms) return;
    if (!active) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    const metadata = makeMetadata({ title, artist, album });
    if (metadata) ms.metadata = metadata;
    ms.playbackState = playing ? 'playing' : 'paused';

    return () => {
      ms.metadata = null;
      ms.playbackState = 'none';
    };
  }, [active, playing, title, artist, album]);
}

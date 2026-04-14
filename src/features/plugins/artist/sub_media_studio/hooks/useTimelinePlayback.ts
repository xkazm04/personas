import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

/**
 * Imperative playback engine.
 *
 * `currentTime` is intentionally NOT React state — storing it in state would
 * trigger a full re-render on every rAF tick (≈60/s), which made the original
 * media studio unusably laggy. Instead, the authoritative clock lives in a ref
 * and consumers subscribe for updates via `subscribe(cb)`. Each consumer then
 * decides whether to touch the DOM directly (playhead, video element) or call
 * a local `setState` scoped just to itself (time readouts, overlay filters).
 */
export interface PlaybackEngine {
  getTime(): number;
  getPlaying(): boolean;
  subscribe(cb: (time: number) => void): () => void;
}

export interface UseTimelinePlaybackReturn {
  engine: PlaybackEngine;
  playing: boolean;
  looping: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  toggleLoop: () => void;
}

export function useTimelinePlayback(totalDuration: number): UseTimelinePlaybackReturn {
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);

  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const loopingRef = useRef(false);
  const totalRef = useRef(totalDuration);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const subscribersRef = useRef<Set<(t: number) => void>>(new Set());

  // Keep refs aligned with the latest props/state
  totalRef.current = totalDuration;
  loopingRef.current = looping;

  const notify = useCallback((time: number) => {
    subscribersRef.current.forEach((cb) => cb(time));
  }, []);

  const tick = useCallback(
    (now: number) => {
      if (!playingRef.current) return;
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;

      let next = timeRef.current + dt;
      if (next >= totalRef.current) {
        if (loopingRef.current) {
          next = 0;
        } else {
          timeRef.current = totalRef.current;
          playingRef.current = false;
          rafRef.current = null;
          notify(totalRef.current);
          setPlaying(false);
          return;
        }
      }
      timeRef.current = next;
      notify(next);
      rafRef.current = requestAnimationFrame(tick);
    },
    [notify],
  );

  const play = useCallback(() => {
    if (playingRef.current) return;
    if (timeRef.current >= totalRef.current) {
      timeRef.current = 0;
      notify(0);
    }
    playingRef.current = true;
    setPlaying(true);
    lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick, notify]);

  const pause = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    playingRef.current = false;
    timeRef.current = 0;
    notify(0);
    setPlaying(false);
  }, [notify]);

  const seek = useCallback(
    (time: number) => {
      const t = Math.max(0, Math.min(time, totalRef.current));
      timeRef.current = t;
      notify(t);
    },
    [notify],
  );

  const toggleLoop = useCallback(() => {
    setLooping((prev) => !prev);
  }, []);

  // Stable engine reference — subscribers captured once, identity never changes
  const engine = useMemo<PlaybackEngine>(
    () => ({
      getTime: () => timeRef.current,
      getPlaying: () => playingRef.current,
      subscribe: (cb) => {
        subscribersRef.current.add(cb);
        cb(timeRef.current);
        return () => {
          subscribersRef.current.delete(cb);
        };
      },
    }),
    [],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    engine,
    playing,
    looping,
    play,
    pause,
    stop,
    seek,
    toggleLoop,
  };
}

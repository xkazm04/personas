import { useState, useRef, useCallback } from 'react';

/**
 * rAF-based playback clock.
 * Increments `currentTime` by real elapsed time each frame.
 * Supports loop mode — when enabled, wraps back to 0 at end.
 */
export function useTimelinePlayback(totalDuration: number) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);

  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const loopRef = useRef(looping);
  loopRef.current = looping;

  const tick = useCallback(
    (now: number) => {
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;

      setCurrentTime((prev) => {
        const next = prev + dt;
        if (next >= totalDuration) {
          if (loopRef.current) {
            // Loop: wrap back to 0
            rafRef.current = requestAnimationFrame(tick);
            return 0;
          }
          // Reached end — stop
          setPlaying(false);
          rafRef.current = null;
          return totalDuration;
        }
        rafRef.current = requestAnimationFrame(tick);
        return next;
      });
    },
    [totalDuration],
  );

  const play = useCallback(() => {
    if (rafRef.current) return;
    // If at end and not looping, reset to start
    setCurrentTime((prev) => {
      if (prev >= totalDuration) return 0;
      return prev;
    });
    setPlaying(true);
    lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick, totalDuration]);

  const pause = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPlaying(false);
    setCurrentTime(0);
  }, []);

  const seek = useCallback(
    (time: number) => {
      setCurrentTime(Math.max(0, Math.min(time, totalDuration)));
    },
    [totalDuration],
  );

  const toggleLoop = useCallback(() => {
    setLooping((prev) => !prev);
  }, []);

  return { currentTime, playing, looping, play, pause, stop, seek, toggleLoop };
}

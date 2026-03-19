/**
 * useDreamReplay -- Hook for deterministic dream replay with span-tree stepping.
 *
 * Fetches a DreamReplaySession from the backend and provides:
 * - Frame-by-frame stepping (forward/backward through span boundaries)
 * - Time-based scrubbing (jump to any ms position)
 * - Playback with speed control
 * - Current frame state with all active/completed spans
 * - Zero-cost replay indicator
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import type { DreamReplaySession } from '@/lib/bindings/DreamReplaySession';
import type { DreamFrame } from '@/lib/bindings/DreamFrame';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { getDreamReplay } from '@/api/agents/executions';

export interface DreamReplayState {
  /** The full replay session (null while loading). */
  session: DreamReplaySession | null;
  /** Current frame index. */
  currentFrameIndex: number;
  /** Current frame (null if no frames). */
  currentFrame: DreamFrame | null;
  /** All frames. */
  frames: DreamFrame[];
  /** Total frame count. */
  totalFrames: number;
  /** Current ms position (derived from current frame). */
  currentMs: number;
  /** Total execution duration. */
  totalMs: number;
  /** Whether playback is active. */
  isPlaying: boolean;
  /** Playback speed multiplier. */
  speed: number;
  /** Spans currently active at the current frame. */
  activeSpans: TraceSpan[];
  /** Spans completed by the current frame. */
  completedSpans: TraceSpan[];
  /** Current span depth level. */
  currentDepth: number;
  /** Whether the session is loading. */
  isLoading: boolean;
  /** Error message. */
  error: string | null;
  /** Span lookup map for quick access. */
  spanMap: Map<string, TraceSpan>;
}

export interface DreamReplayActions {
  /** Step to next span boundary. */
  stepForward: () => void;
  /** Step to previous span boundary. */
  stepBackward: () => void;
  /** Jump to a specific frame index. */
  jumpToFrame: (index: number) => void;
  /** Scrub to nearest frame at the given ms position. */
  scrubToMs: (ms: number) => void;
  /** Start playback. */
  play: () => void;
  /** Pause playback. */
  pause: () => void;
  /** Toggle play/pause. */
  togglePlay: () => void;
  /** Set playback speed. */
  setSpeed: (speed: number) => void;
  /** Jump to start. */
  jumpToStart: () => void;
  /** Jump to end. */
  jumpToEnd: () => void;
  /** Jump to next error frame. */
  jumpToNextError: () => void;
  /** Jump to previous error frame. */
  jumpToPrevError: () => void;
}

export function useDreamReplay(
  execution: PersonaExecution,
): [DreamReplayState, DreamReplayActions] {
  const [session, setSession] = useState<DreamReplaySession | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  // Fetch session
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getDreamReplay(execution.id, execution.persona_id)
      .then((result) => {
        if (cancelled) return;
        setSession(result);
        setCurrentFrameIndex(0);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [execution.id, execution.persona_id]);

  const frames = session?.frames ?? [];
  const totalFrames = frames.length;
  const totalMs = session?.totalDurationMs ?? 0;

  const currentFrame = totalFrames > 0 ? frames[currentFrameIndex] ?? null : null;
  const currentMs = currentFrame?.timestampMs ?? 0;

  // Build span lookup map
  const spanMap = useMemo(() => {
    const map = new Map<string, TraceSpan>();
    for (const span of session?.spans ?? []) {
      map.set(span.span_id, span);
    }
    return map;
  }, [session]);

  // Derive active/completed spans from current frame
  const activeSpans = useMemo(() => {
    if (!currentFrame) return [];
    return currentFrame.activeSpanIds
      .map((id) => spanMap.get(id))
      .filter((s): s is TraceSpan => s != null);
  }, [currentFrame, spanMap]);

  const completedSpans = useMemo(() => {
    if (!currentFrame) return [];
    return currentFrame.completedSpanIds
      .map((id) => spanMap.get(id))
      .filter((s): s is TraceSpan => s != null)
      .sort((a, b) => (b.end_ms ?? 0) - (a.end_ms ?? 0))
      .slice(0, 20);
  }, [currentFrame, spanMap]);

  const currentDepth = currentFrame?.depth ?? 0;

  // Playback loop -- step through frames at speed
  useEffect(() => {
    if (!isPlaying || totalFrames === 0) return;
    lastTickRef.current = performance.now();

    const tick = (now: number) => {
      const elapsedReal = now - lastTickRef.current;
      const elapsedSim = elapsedReal * speed;
      lastTickRef.current = now;

      setCurrentFrameIndex((prev) => {
        const prevFrame = frames[prev];
        if (!prevFrame) {
          setIsPlaying(false);
          return prev;
        }
        const targetMs = prevFrame.timestampMs + elapsedSim;
        // Find next frame at or past targetMs
        let next = prev;
        while (next < totalFrames - 1 && (frames[next + 1]?.timestampMs ?? Infinity) <= targetMs) {
          next++;
        }
        if (next >= totalFrames - 1) {
          setIsPlaying(false);
          return totalFrames - 1;
        }
        return next;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, speed, totalFrames, frames]);

  // Actions
  const stepForward = useCallback(() => {
    setCurrentFrameIndex((prev) => Math.min(prev + 1, totalFrames - 1));
  }, [totalFrames]);

  const stepBackward = useCallback(() => {
    setCurrentFrameIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const jumpToFrame = useCallback((index: number) => {
    setCurrentFrameIndex(Math.max(0, Math.min(index, totalFrames - 1)));
  }, [totalFrames]);

  const scrubToMs = useCallback((ms: number) => {
    if (totalFrames === 0) return;
    // Binary search for nearest frame
    let lo = 0;
    let hi = totalFrames - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((frames[mid]?.timestampMs ?? Infinity) <= ms) lo = mid;
      else hi = mid - 1;
    }
    setCurrentFrameIndex(lo);
  }, [totalFrames, frames]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const jumpToStart = useCallback(() => { setCurrentFrameIndex(0); setIsPlaying(false); }, []);
  const jumpToEnd = useCallback(() => { setCurrentFrameIndex(Math.max(0, totalFrames - 1)); setIsPlaying(false); }, [totalFrames]);

  const jumpToNextError = useCallback(() => {
    const next = frames.findIndex((f, i) => i > currentFrameIndex && f.error != null);
    if (next >= 0) setCurrentFrameIndex(next);
  }, [frames, currentFrameIndex]);

  const jumpToPrevError = useCallback(() => {
    for (let i = currentFrameIndex - 1; i >= 0; i--) {
      if (frames[i]?.error != null) {
        setCurrentFrameIndex(i);
        return;
      }
    }
  }, [frames, currentFrameIndex]);

  const state: DreamReplayState = {
    session,
    currentFrameIndex,
    currentFrame,
    frames,
    totalFrames,
    currentMs,
    totalMs,
    isPlaying,
    speed,
    activeSpans,
    completedSpans,
    currentDepth,
    isLoading,
    error,
    spanMap,
  };

  const actions: DreamReplayActions = {
    stepForward,
    stepBackward,
    jumpToFrame,
    scrubToMs,
    play,
    pause,
    togglePlay,
    setSpeed,
    jumpToStart,
    jumpToEnd,
    jumpToNextError,
    jumpToPrevError,
  };

  return [state, actions];
}

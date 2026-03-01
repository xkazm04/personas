/**
 * useReplayTimeline — Core hook for execution replay with time-scrubbing.
 *
 * Reconstructs a unified timeline from tool_steps and log lines,
 * providing scrubbing, playback, and fork-point selection.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

export interface ToolCallStep {
  step_index: number;
  tool_name: string;
  input_preview: string;
  output_preview: string;
  started_at_ms: number;
  ended_at_ms?: number;
  duration_ms?: number;
}

export interface TimelineLogLine {
  index: number;
  text: string;
  /** Estimated timestamp in ms from execution start. */
  timestamp_ms: number;
}

export interface ReplayState {
  /** Current scrub position in ms from execution start. */
  currentMs: number;
  /** Total execution duration in ms. */
  totalMs: number;
  /** Whether auto-playback is active. */
  isPlaying: boolean;
  /** Playback speed multiplier (1x, 2x, 4x, 8x). */
  speed: number;
  /** All parsed tool steps. */
  toolSteps: ToolCallStep[];
  /** Log lines up to the current scrub position. */
  visibleLines: TimelineLogLine[];
  /** All log lines with timestamps. */
  allLines: TimelineLogLine[];
  /** Tool steps completed by current position. */
  completedSteps: ToolCallStep[];
  /** Currently active tool step (started but not ended). */
  activeStep: ToolCallStep | null;
  /** Tool steps not yet started. */
  pendingSteps: ToolCallStep[];
  /** Cumulative cost up to current position (proportional estimate). */
  accumulatedCost: number;
  /** Current fork point (step index, or null). */
  forkPoint: number | null;
}

export interface ReplayActions {
  /** Set scrub position to a specific ms value. */
  scrubTo: (ms: number) => void;
  /** Start auto-playback. */
  play: () => void;
  /** Pause auto-playback. */
  pause: () => void;
  /** Toggle play/pause. */
  togglePlay: () => void;
  /** Set playback speed (1, 2, 4, 8). */
  setSpeed: (speed: number) => void;
  /** Jump to start. */
  jumpToStart: () => void;
  /** Jump to end. */
  jumpToEnd: () => void;
  /** Step forward to next tool call boundary. */
  stepForward: () => void;
  /** Step backward to previous tool call boundary. */
  stepBackward: () => void;
  /** Set fork point at a specific step index. */
  setForkPoint: (stepIndex: number | null) => void;
}

function parseToolSteps(raw: string | null): ToolCallStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildTimelineLines(logContent: string | null, totalMs: number): TimelineLogLine[] {
  if (!logContent) return [];
  const raw = logContent.split('\n');
  if (raw.length === 0 || totalMs <= 0) return [];

  return raw.map((text, index) => ({
    index,
    text,
    timestamp_ms: totalMs > 0 ? (index / Math.max(raw.length - 1, 1)) * totalMs : 0,
  }));
}

export function useReplayTimeline(
  toolStepsJson: string | null,
  logContent: string | null,
  durationMs: number | null,
  totalCost: number,
): [ReplayState, ReplayActions] {
  const totalMs = durationMs ?? 0;
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [forkPoint, setForkPoint] = useState<number | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const toolSteps = useMemo(() => parseToolSteps(toolStepsJson), [toolStepsJson]);
  const allLines = useMemo(() => buildTimelineLines(logContent, totalMs), [logContent, totalMs]);

  // Derive visible lines at current position
  const visibleLines = useMemo(
    () => allLines.filter((l) => l.timestamp_ms <= currentMs),
    [allLines, currentMs],
  );

  // Derive tool step states at current position
  const completedSteps = useMemo(
    () => toolSteps.filter((s) => s.ended_at_ms != null && s.ended_at_ms <= currentMs),
    [toolSteps, currentMs],
  );

  const activeStep = useMemo(
    () => toolSteps.find((s) => s.started_at_ms <= currentMs && (s.ended_at_ms == null || s.ended_at_ms > currentMs)) ?? null,
    [toolSteps, currentMs],
  );

  const pendingSteps = useMemo(
    () => toolSteps.filter((s) => s.started_at_ms > currentMs),
    [toolSteps, currentMs],
  );

  // Proportional cost accumulation
  const accumulatedCost = useMemo(() => {
    if (totalMs <= 0 || totalCost <= 0) return 0;
    // Weight cost by tool step completion
    if (toolSteps.length === 0) return (currentMs / totalMs) * totalCost;
    const completedFraction = completedSteps.length / toolSteps.length;
    const activeFraction = activeStep
      ? ((currentMs - activeStep.started_at_ms) / Math.max((activeStep.ended_at_ms ?? totalMs) - activeStep.started_at_ms, 1)) / toolSteps.length
      : 0;
    return (completedFraction + activeFraction) * totalCost;
  }, [totalMs, totalCost, toolSteps, completedSteps, activeStep, currentMs]);

  // Playback animation loop
  useEffect(() => {
    if (!isPlaying) return;
    lastTickRef.current = performance.now();

    const tick = (now: number) => {
      const delta = (now - lastTickRef.current) * speed;
      lastTickRef.current = now;
      setCurrentMs((prev) => {
        const next = prev + delta;
        if (next >= totalMs) {
          setIsPlaying(false);
          return totalMs;
        }
        return next;
      });
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, speed, totalMs]);

  // Tool step boundaries for stepping
  const boundaries = useMemo(() => {
    const pts = new Set<number>([0, totalMs]);
    for (const s of toolSteps) {
      pts.add(s.started_at_ms);
      if (s.ended_at_ms != null) pts.add(s.ended_at_ms);
    }
    return Array.from(pts).sort((a, b) => a - b);
  }, [toolSteps, totalMs]);

  const scrubTo = useCallback((ms: number) => {
    setCurrentMs(Math.max(0, Math.min(ms, totalMs)));
  }, [totalMs]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const jumpToStart = useCallback(() => { setCurrentMs(0); setIsPlaying(false); }, []);
  const jumpToEnd = useCallback(() => { setCurrentMs(totalMs); setIsPlaying(false); }, [totalMs]);

  const stepForward = useCallback(() => {
    const next = boundaries.find((b) => b > currentMs + 1);
    if (next != null) setCurrentMs(next);
  }, [boundaries, currentMs]);

  const stepBackward = useCallback(() => {
    const prev = [...boundaries].reverse().find((b) => b < currentMs - 1);
    if (prev != null) setCurrentMs(prev);
  }, [boundaries, currentMs]);

  const state: ReplayState = {
    currentMs,
    totalMs,
    isPlaying,
    speed,
    toolSteps,
    visibleLines,
    allLines,
    completedSteps,
    activeStep,
    pendingSteps,
    accumulatedCost,
    forkPoint,
  };

  const actions: ReplayActions = {
    scrubTo,
    play,
    pause,
    togglePlay,
    setSpeed,
    jumpToStart,
    jumpToEnd,
    stepForward,
    stepBackward,
    setForkPoint,
  };

  return [state, actions];
}

/**
 * useReplayTimeline -- Core hook for execution replay with time-scrubbing.
 *
 * Reconstructs a unified timeline from tool_steps and log lines,
 * providing scrubbing, playback, and fork-point selection.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';

export type { ToolCallStep };

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
  /** Every step with the window the replay treats it as occupying. */
  stepSpans: ToolStepSpan[];
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

/**
 * Normalize the `tool_steps` column into an array.
 *
 * The column is typed `Vec<ToolCallStep>` in Rust but arrives through a JSON
 * blob, so a legacy or hand-edited row can be anything at all; everything
 * downstream indexes it, so the narrowing happens once, here.
 *
 * Exported because `trace/stageColors.ts` carries a byte-identical private
 * copy of it — the two must not drift, and this is the one with tests.
 */
export function parseToolSteps(raw: ToolCallStep[] | null): ToolCallStep[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [];
}

/** A tool step plus the window the replay actually treats it as occupying. */
export interface ToolStepSpan {
  step: ToolCallStep;
  start_ms: number;
  /** `ended_at_ms` when the record has one; otherwise an inferred bound. */
  end_ms: number;
  /** True when `ended_at_ms` was absent and `end_ms` is inferred. */
  inferred_end: boolean;
}

/**
 * Give every step a bounded window, including the ones the record never closed.
 *
 * A step with `ended_at_ms == null` used to satisfy `activeStep`'s predicate
 * for EVERY later scrub position, so one unclosed step mid-list masked every
 * step after it, kept itself out of `completedSteps` forever, and left
 * `accumulatedCost` short of `totalCost` at the End marker. On the two DB
 * snapshots behind the writer-side fix that was 240 of 2,998 persisted steps
 * (8.0%), across 80 of 252 executions (31.7%) — and 239 of the 240 were
 * mid-list, i.e. exactly the masking case.
 *
 * The runner now closes steps as they finish and stamps any straggler at
 * persist time, so new rows arrive closed. This is what makes the ~80 historical
 * executions readable: an unclosed step is treated as running only until the
 * NEXT step starts — the last moment the record can support — and, for the
 * final step, until the end of the run.
 */
export function buildToolStepSpans(steps: ToolCallStep[], totalMs: number): ToolStepSpan[] {
  return steps.map((step, i) => {
    const start_ms = Number(step.started_at_ms);
    if (step.ended_at_ms != null) {
      return { step, start_ms, end_ms: Number(step.ended_at_ms), inferred_end: false };
    }
    const nextStart = steps[i + 1] != null ? Number(steps[i + 1]!.started_at_ms) : null;
    // Never before its own start: a malformed row must not invert the window.
    const bound = Math.max(nextStart ?? totalMs, start_ms);
    return { step, start_ms, end_ms: bound, inferred_end: true };
  });
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

/** Upper-bound binary search: count of lines with timestamp_ms <= cutoffMs (lines are sorted). */
export function countVisibleLines(lines: TimelineLogLine[], cutoffMs: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid]!.timestamp_ms <= cutoffMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Throttle playback state flushes to ~12/sec so derived line lists don't recompute at 60fps. */
const PLAYBACK_FLUSH_MS = 80;

export function useReplayTimeline(
  toolStepsJson: ToolCallStep[] | null,
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

  useEffect(() => {
    setCurrentMs(0);
    setIsPlaying(false);
    setSpeed(1);
    setForkPoint(null);
  }, [toolStepsJson, logContent, totalMs]);

  // Derive visible lines at current position. allLines is sorted by
  // timestamp_ms, so binary-search the cutoff index (O(log n) per scrub)
  // and only allocate a new array when the visible count actually changes.
  const visibleCount = useMemo(
    () => countVisibleLines(allLines, currentMs),
    [allLines, currentMs],
  );

  const visibleLines = useMemo(
    () => allLines.slice(0, visibleCount),
    [allLines, visibleCount],
  );

  // Derive tool step states at current position. Everything below reads the
  // spans rather than `ended_at_ms` directly, so an unclosed historical step
  // is bounded instead of swallowing the rest of the timeline.
  const stepSpans = useMemo(() => buildToolStepSpans(toolSteps, totalMs), [toolSteps, totalMs]);

  const completedSteps = useMemo(
    () => stepSpans.filter((s) => s.end_ms <= currentMs).map((s) => s.step),
    [stepSpans, currentMs],
  );

  const activeSpan = useMemo(
    () => stepSpans.find((s) => s.start_ms <= currentMs && s.end_ms > currentMs) ?? null,
    [stepSpans, currentMs],
  );
  const activeStep = activeSpan?.step ?? null;

  const pendingSteps = useMemo(
    () => stepSpans.filter((s) => s.start_ms > currentMs).map((s) => s.step),
    [stepSpans, currentMs],
  );

  // Proportional cost accumulation
  const accumulatedCost = useMemo(() => {
    if (totalMs <= 0 || totalCost <= 0) return 0;
    // Weight cost by tool step completion
    if (toolSteps.length === 0) return (currentMs / totalMs) * totalCost;
    const completedFraction = completedSteps.length / toolSteps.length;
    const activeFraction = activeSpan
      ? ((currentMs - activeSpan.start_ms) / Math.max(activeSpan.end_ms - activeSpan.start_ms, 1)) / toolSteps.length
      : 0;
    return (completedFraction + activeFraction) * totalCost;
  }, [totalMs, totalCost, toolSteps, completedSteps, activeSpan, currentMs]);

  // Playback animation loop. Time is accumulated per rAF for accuracy, but
  // state flushes are throttled (PLAYBACK_FLUSH_MS) so the replay view does
  // not re-render and re-derive line lists at 60fps.
  useEffect(() => {
    if (!isPlaying) return;
    lastTickRef.current = performance.now();
    let lastFlush = performance.now();
    let pendingDelta = 0;

    const tick = (now: number) => {
      pendingDelta += (now - lastTickRef.current) * speed;
      lastTickRef.current = now;
      if (now - lastFlush >= PLAYBACK_FLUSH_MS) {
        lastFlush = now;
        const delta = pendingDelta;
        pendingDelta = 0;
        setCurrentMs((prev) => Math.min(prev + delta, totalMs));
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, speed, totalMs]);

  // Stop playback once the scrub position reaches the end (kept outside the
  // setCurrentMs updater so state updaters stay pure).
  useEffect(() => {
    if (isPlaying && currentMs >= totalMs) setIsPlaying(false);
  }, [isPlaying, currentMs, totalMs]);

  // Tool step boundaries for stepping
  const boundaries = useMemo(() => {
    const pts = new Set<number>([0, totalMs]);
    for (const s of stepSpans) {
      pts.add(s.start_ms);
      pts.add(s.end_ms);
    }
    return Array.from(pts).sort((a, b) => a - b);
  }, [stepSpans, totalMs]);

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
    stepSpans,
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

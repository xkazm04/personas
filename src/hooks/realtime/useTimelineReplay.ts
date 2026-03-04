import { useState, useCallback, useRef, useEffect } from 'react';
import { listEventsInRange } from '@/api/events';
import type { RealtimeEvent, AnimationPhase } from '@/hooks/realtime/useRealtimeEvents';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import { useEventPhaseProgressor } from '@/hooks/realtime/useEventPhaseProgressor';

// ── Types ──────────────────────────────────────────────────────────

export type TimeRange = '1d' | '7d';
export type PlaybackSpeed = 2 | 4 | 8 | 16 | 32 | 64;

export interface TimelineReplayState {
  /** Whether we're in replay mode at all */
  active: boolean;
  /** Raw historical events loaded from DB */
  historicalEvents: PersonaEvent[];
  /** Currently replaying events (fed to visualization) */
  replayEvents: RealtimeEvent[];
  /** Is the replay currently playing */
  playing: boolean;
  /** Loading historical data */
  loading: boolean;
  /** Selected time range */
  range: TimeRange;
  /** Playback speed multiplier */
  speed: PlaybackSpeed;
  /** Current replay position in virtual time (ms since range start) */
  cursorMs: number;
  /** Total duration of the range in real ms */
  totalMs: number;
  /** Timestamp of range start */
  rangeStart: number;
  /** Timestamp of range end */
  rangeEnd: number;
  /** Total events in range */
  totalEventCount: number;
  /** Events emitted so far */
  emittedCount: number;
}

export interface UseTimelineReplayReturn extends TimelineReplayState {
  enterReplay: (range: TimeRange) => Promise<void>;
  exitReplay: () => void;
  togglePlay: () => void;
  setSpeed: (s: PlaybackSpeed) => void;
  seekTo: (fractionOrMs: number, isMs?: boolean) => void;
}

// ── Constants ──────────────────────────────────────────────────────

const TICK_INTERVAL = 50; // ms between replay ticks
const MAX_REPLAY_EVENTS = 5000;

// ── Hook ───────────────────────────────────────────────────────────

export function useTimelineReplay(): UseTimelineReplayReturn {
  const [active, setActive] = useState(false);
  const [historicalEvents, setHistoricalEvents] = useState<PersonaEvent[]>([]);
  const [replayEvents, setReplayEvents] = useState<RealtimeEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<TimeRange>('1d');
  const [speed, setSpeedState] = useState<PlaybackSpeed>(8);
  const [cursorMs, setCursorMs] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [emittedCount, setEmittedCount] = useState(0);

  const totalMs = rangeEnd - rangeStart || 1;

  // Refs for the animation loop
  const playingRef = useRef(false);
  const speedRef = useRef<PlaybackSpeed>(8);
  const cursorRef = useRef(0);
  const rangeStartRef = useRef(0);
  const rangeEndRef = useRef(0);
  const eventsRef = useRef<PersonaEvent[]>([]);
  const nextEventIdxRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  // Keep refs in sync
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { eventsRef.current = historicalEvents; }, [historicalEvents]);

  const findFirstAfter = useCallback((events: PersonaEvent[], cursorTime: number) => {
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const evtTime = new Date(events[mid]!.created_at).getTime();
      if (evtTime <= cursorTime) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }, []);

  useEventPhaseProgressor({ active, setEvents: setReplayEvents });

  // ── Replay tick loop ─────────────────────────────────────────────
  const tick = useCallback(() => {
    if (!playingRef.current) return;

    const now = Date.now();
    const dt = now - lastTickRef.current;
    lastTickRef.current = now;

    // Advance virtual cursor by dt * speed
    const advance = dt * speedRef.current;
    const newCursor = Math.min(cursorRef.current + advance, rangeEndRef.current - rangeStartRef.current);
    cursorRef.current = newCursor;
    setCursorMs(newCursor);

    // Emit events whose created_at falls before the cursor
    const cursorTime = rangeStartRef.current + newCursor;
    const events = eventsRef.current;
    const batchLimit = 12; // max events per tick to avoid flooding
    let emitted = 0;
    while (nextEventIdxRef.current < events.length && emitted < batchLimit) {
      const evt = events[nextEventIdxRef.current]!;
      const evtTime = new Date(evt.created_at).getTime();
      if (evtTime > cursorTime) break;

      // Convert to RealtimeEvent
      const realtimeEvt: RealtimeEvent = {
        ...evt,
        _animationId: `replay-${evt.id}-${nextEventIdxRef.current}`,
        _phase: 'entering' as AnimationPhase,
        _phaseStartedAt: Date.now(),
      };
      setReplayEvents((prev) => {
        const next = [realtimeEvt, ...prev];
        return next.length > 60 ? next.slice(0, 60) : next;
      });

      nextEventIdxRef.current++;
      emitted++;
    }
    setEmittedCount(nextEventIdxRef.current);

    // Stop at the end
    if (newCursor >= rangeEndRef.current - rangeStartRef.current) {
      setPlaying(false);
      playingRef.current = false;
    }
  }, []);

  // Start/stop the interval based on playing state
  useEffect(() => {
    if (playing && active) {
      lastTickRef.current = Date.now();
      timerRef.current = window.setInterval(tick, TICK_INTERVAL);
    } else if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, active, tick]);

  // ── Public API ───────────────────────────────────────────────────

  const enterReplay = useCallback(async (newRange: TimeRange) => {
    setLoading(true);
    setRange(newRange);

    const now = new Date();
    const end = now.toISOString();
    const start = new Date(
      now.getTime() - (newRange === '1d' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)
    ).toISOString();

    try {
      const events = await listEventsInRange(start, end);
      const sorted = [...events].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const limited = sorted.length > MAX_REPLAY_EVENTS
        ? sorted.slice(sorted.length - MAX_REPLAY_EVENTS)
        : sorted;
      const startMs = new Date(start).getTime();
      const endMs = now.getTime();

      setHistoricalEvents(limited);
      setRangeStart(startMs);
      setRangeEnd(endMs);
      rangeStartRef.current = startMs;
      rangeEndRef.current = endMs;
      setCursorMs(0);
      cursorRef.current = 0;
      nextEventIdxRef.current = 0;
      setEmittedCount(0);
      setReplayEvents([]);
      setActive(true);
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const exitReplay = useCallback(() => {
    setActive(false);
    setPlaying(false);
    playingRef.current = false;
    setReplayEvents([]);
    setHistoricalEvents([]);
    setCursorMs(0);
    setEmittedCount(0);
    cursorRef.current = 0;
    nextEventIdxRef.current = 0;
  }, []);

  const togglePlay = useCallback(() => {
    // If at the end, reset
    if (cursorRef.current >= rangeEndRef.current - rangeStartRef.current) {
      cursorRef.current = 0;
      setCursorMs(0);
      nextEventIdxRef.current = 0;
      setEmittedCount(0);
      setReplayEvents([]);
    }
    setPlaying((p) => !p);
  }, []);

  const setSpeed = useCallback((s: PlaybackSpeed) => {
    setSpeedState(s);
    speedRef.current = s;
  }, []);

  const seekTo = useCallback((value: number, isMs = false) => {
    const total = rangeEndRef.current - rangeStartRef.current;
    const ms = isMs ? Math.max(0, Math.min(value, total)) : Math.max(0, Math.min(value, 1)) * total;

    cursorRef.current = ms;
    setCursorMs(ms);

    // Recompute nextEventIdx — find first event after cursor
    const cursorTime = rangeStartRef.current + ms;
    const events = eventsRef.current;
    const idx = findFirstAfter(events, cursorTime);
    nextEventIdxRef.current = idx;
    setEmittedCount(idx);
    setReplayEvents([]); // clear current particles on seek
  }, [findFirstAfter]);

  return {
    active,
    historicalEvents,
    replayEvents,
    playing,
    loading,
    range,
    speed,
    cursorMs,
    totalMs,
    rangeStart,
    rangeEnd,
    totalEventCount: historicalEvents.length,
    emittedCount,
    enterReplay,
    exitReplay,
    togglePlay,
    setSpeed,
    seekTo,
  };
}

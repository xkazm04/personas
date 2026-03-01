import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { listEventsInRange } from '@/api/events';
import type { RealtimeEvent, AnimationPhase } from '@/hooks/realtime/useRealtimeEvents';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';

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

const PHASE_DURATIONS: Record<AnimationPhase, number> = {
  entering: 400,
  'on-bus': 800,
  delivering: 600,
  done: 2000,
};

const TICK_INTERVAL = 50; // ms between replay ticks

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

  // Emitted count derived from nextEventIdxRef — we track via cursor position
  const emittedCount = useMemo(() => {
    if (!active || historicalEvents.length === 0) return 0;
    const cursorTime = rangeStart + cursorMs;
    let count = 0;
    for (const e of historicalEvents) {
      if (new Date(e.created_at).getTime() <= cursorTime) count++;
      else break; // events are sorted ASC
    }
    return count;
  }, [active, historicalEvents, rangeStart, cursorMs]);

  // ── Phase progression for replay events ──────────────────────────
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setReplayEvents((prev) => {
        if (prev.length === 0) return prev;
        let changed = false;
        const updated: RealtimeEvent[] = [];
        for (const e of prev) {
          const elapsed = now - e._phaseStartedAt;
          if (e._phase === 'done') {
            if (elapsed < PHASE_DURATIONS.done) {
              updated.push(e);
            } else {
              changed = true; // prune
            }
            continue;
          }
          const dur = PHASE_DURATIONS[e._phase];
          if (elapsed > dur) {
            const nextPhase: AnimationPhase =
              e._phase === 'entering' ? 'on-bus' :
              e._phase === 'on-bus' ? 'delivering' : 'done';
            updated.push({ ...e, _phase: nextPhase, _phaseStartedAt: now });
            changed = true;
          } else {
            updated.push(e);
          }
        }
        return changed ? updated : prev;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [active]);

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
      const startMs = new Date(start).getTime();
      const endMs = now.getTime();

      setHistoricalEvents(events);
      setRangeStart(startMs);
      setRangeEnd(endMs);
      rangeStartRef.current = startMs;
      rangeEndRef.current = endMs;
      setCursorMs(0);
      cursorRef.current = 0;
      nextEventIdxRef.current = 0;
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
    cursorRef.current = 0;
    nextEventIdxRef.current = 0;
  }, []);

  const togglePlay = useCallback(() => {
    // If at the end, reset
    if (cursorRef.current >= rangeEndRef.current - rangeStartRef.current) {
      cursorRef.current = 0;
      setCursorMs(0);
      nextEventIdxRef.current = 0;
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
    let idx = 0;
    while (idx < events.length) {
      const evtTime = new Date(events[idx]!.created_at).getTime();
      if (evtTime > cursorTime) break;
      idx++;
    }
    nextEventIdxRef.current = idx;
    setReplayEvents([]); // clear current particles on seek
  }, []);

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

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { testEventFlow } from '@/api/tauriApi';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';

// ── Color Map (derived from canonical EVENT_TYPE_COLORS) ──────────
import { EVENT_TYPE_COLORS } from '@/lib/utils/formatters';

export const EVENT_TYPE_HEX_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_TYPE_COLORS).map(([k, v]) => [k, v.hex]),
);

// ── Types ──────────────────────────────────────────────────────────
export type AnimationPhase = 'entering' | 'on-bus' | 'delivering' | 'done';

export interface RealtimeEvent {
  id: string;
  project_id: string;
  event_type: string;
  source_type: string;
  source_id: string | null;
  target_persona_id: string | null;
  payload: string | null;
  status: string;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
  _animationId: string;
  _phase: AnimationPhase;
  _phaseStartedAt: number;
}

export interface RealtimeStats {
  eventsPerMinute: number;
  successRate: number;
  pendingCount: number;
  totalInWindow: number;
  activeSourceIds: string[];
  activeTargetIds: string[];
}

export interface UseRealtimeEventsReturn {
  events: RealtimeEvent[];
  stats: RealtimeStats;
  isPaused: boolean;
  isConnected: boolean;
  selectedEvent: RealtimeEvent | null;
  togglePause: () => void;
  selectEvent: (event: RealtimeEvent | null) => void;
  triggerTestFlow: () => Promise<void>;
  testFlowLoading: boolean;
}

// ── Stats computation ────────────────────────────────────────────
function computeStats(events: RealtimeEvent[]): RealtimeStats {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const windowEvents = events.filter(
    (e) => new Date(e.created_at).getTime() > oneMinuteAgo
  );

  const delivered = windowEvents.filter(
    (e) => e.status === 'completed' || e.status === 'processed'
  ).length;
  const failed = windowEvents.filter((e) => e.status === 'failed').length;
  const pending = events.filter(
    (e) => e.status === 'pending' || e.status === 'processing'
  ).length;
  const total = windowEvents.length;
  const successRate =
    total > 0
      ? Math.round((delivered / Math.max(delivered + failed, 1)) * 100)
      : 100;

  const activeSourceIds = [
    ...new Set(
      windowEvents.map((e) => e.source_id).filter(Boolean) as string[]
    ),
  ];
  const activeTargetIds = [
    ...new Set(
      windowEvents
        .map((e) => e.target_persona_id)
        .filter(Boolean) as string[]
    ),
  ];

  return {
    eventsPerMinute: total,
    successRate,
    pendingCount: pending,
    totalInWindow: total,
    activeSourceIds,
    activeTargetIds,
  };
}

// ── Hook ─────────────────────────────────────────────────────────
export function useRealtimeEvents(): UseRealtimeEventsReturn {
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<RealtimeEvent | null>(
    null
  );
  const [testFlowLoading, setTestFlowLoading] = useState(false);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const stats = useMemo(() => computeStats(events), [events]);

  // Listen to Tauri 'event-bus' events from backend
  const handleBusEvent = useCallback((raw: PersonaEvent) => {
    if (isPausedRef.current) return;

    const realtimeEvent: RealtimeEvent = {
      ...raw,
      _animationId: `${raw.id}-${Date.now()}`,
      _phase: 'entering' as AnimationPhase,
      _phaseStartedAt: Date.now(),
    };

    setEvents((prev) => {
      const next = [realtimeEvent, ...prev];
      return next.length > 200 ? next.slice(0, 200) : next;
    });
  }, []);
  useEventBusListener(handleBusEvent);

  // Mark connected once the hook has been set up
  useEffect(() => {
    setIsConnected(true);
  }, []);

  // Phase progression timer (entering -> on-bus -> delivering -> done)
  // Prunes events 2s after reaching 'done' to avoid unbounded accumulation.
  // Returns the same array reference when nothing changed to avoid re-renders.
  useEffect(() => {
    const DONE_GRACE_MS = 2000;
    const timer = setInterval(() => {
      const now = Date.now();
      setEvents((prev) => {
        if (prev.length === 0) return prev;

        let changed = false;
        const updated: RealtimeEvent[] = [];
        for (const e of prev) {
          if (e._phase === 'done') {
            if (now - e._phaseStartedAt < DONE_GRACE_MS) {
              updated.push(e);
            } else {
              changed = true;
            }
            continue;
          }
          const elapsed = now - e._phaseStartedAt;
          if (e._phase === 'entering' && elapsed > 400) {
            updated.push({ ...e, _phase: 'on-bus', _phaseStartedAt: now });
            changed = true;
          } else if (e._phase === 'on-bus' && elapsed > 800) {
            updated.push({ ...e, _phase: 'delivering', _phaseStartedAt: now });
            changed = true;
          } else if (e._phase === 'delivering' && elapsed > 600) {
            updated.push({ ...e, _phase: 'done', _phaseStartedAt: now });
            changed = true;
          } else {
            updated.push(e);
          }
        }
        return changed ? updated : prev;
      });
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const togglePause = useCallback(() => setIsPaused((p) => !p), []);
  const selectEvent = useCallback(
    (e: RealtimeEvent | null) => setSelectedEvent(e),
    []
  );

  const triggerTestFlow = useCallback(async () => {
    setTestFlowLoading(true);
    try {
      await testEventFlow(
        'test_event',
        JSON.stringify({ test: true, timestamp: new Date().toISOString() })
      );
    } finally {
      setTestFlowLoading(false);
    }
  }, []);

  return {
    events,
    stats,
    isPaused,
    isConnected,
    selectedEvent,
    togglePause,
    selectEvent,
    triggerTestFlow,
    testFlowLoading,
  };
}

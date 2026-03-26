import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { testEventFlow } from "@/api/overview/events";

import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import { useEventPhaseProgressor } from '@/hooks/realtime/useEventPhaseProgressor';

// -- Color Map (from centralized event tokens) ----------
export { EVENT_TYPE_HEX_COLORS } from '@/lib/design/eventTokens';

// -- Types ----------------------------------------------------------
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
  droppedCount: number;
  togglePause: () => void;
  selectEvent: (event: RealtimeEvent | null) => void;
  triggerTestFlow: () => Promise<void>;
  testFlowLoading: boolean;
}

// -- Stats computation --------------------------------------------
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

// -- Hook ---------------------------------------------------------
export function useRealtimeEvents(): UseRealtimeEventsReturn {
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<RealtimeEvent | null>(
    null
  );
  const [testFlowLoading, setTestFlowLoading] = useState(false);
  const isPausedRef = useRef(isPaused);
  const testFlowTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  isPausedRef.current = isPaused;

  const clearPendingTestFlowTimeouts = useCallback(() => {
    for (const timeoutId of testFlowTimeoutsRef.current) {
      clearTimeout(timeoutId);
    }
    testFlowTimeoutsRef.current = [];
  }, []);

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
      if (next.length > 200) {
        setDroppedCount((c) => c + next.length - 200);
        return next.slice(0, 200);
      }
      return next;
    });
  }, []);
  const isConnected = useEventBusListener(handleBusEvent);

  useEventPhaseProgressor({ active: !isPaused, setEvents });

  useEffect(() => () => {
    clearPendingTestFlowTimeouts();
  }, [clearPendingTestFlowTimeouts]);

  const togglePause = useCallback(() => setIsPaused((p) => !p), []);
  const selectEvent = useCallback(
    (e: RealtimeEvent | null) => setSelectedEvent(e),
    []
  );

  const triggerTestFlow = useCallback(async () => {
    clearPendingTestFlowTimeouts();
    setTestFlowLoading(true);
    try {
      // Fire the backend test event
      await testEventFlow(
        'test_event',
        JSON.stringify({ test: true, timestamp: new Date().toISOString() })
      );

      // Also inject simulated visual events to create lively traffic
      const simSources = [
        { type: 'webhook', id: 'gmail', label: 'Gmail' },
        { type: 'webhook', id: 'slack', label: 'Slack' },
        { type: 'trigger', id: 'github', label: 'GitHub' },
        { type: 'system', id: 'calendar', label: 'Calendar' },
      ];
      const simEventTypes = ['webhook_received', 'execution_completed', 'persona_action', 'test_event'];

      for (let i = 0; i < 4; i++) {
        const src = simSources[i % simSources.length]!;
        const timeoutId = setTimeout(() => {
          if (isPausedRef.current) return;
          const simEvent: RealtimeEvent = {
            id: `sim-${Date.now()}-${i}`,
            project_id: 'test',
            event_type: simEventTypes[i % simEventTypes.length]!,
            source_type: src.type,
            source_id: src.id,
            target_persona_id: null,
            payload: JSON.stringify({ simulated: true, index: i }),
            status: 'completed',
            error_message: null,
            processed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            _animationId: `sim-${Date.now()}-${i}`,
            _phase: 'entering',
            _phaseStartedAt: Date.now(),
          };
          setEvents((prev) => {
            const next = [simEvent, ...prev];
            if (next.length > 200) {
              setDroppedCount((c) => c + next.length - 200);
              return next.slice(0, 200);
            }
            return next;
          });
        }, i * 350);
        testFlowTimeoutsRef.current.push(timeoutId);
      }
    } finally {
      setTestFlowLoading(false);
    }
  }, [clearPendingTestFlowTimeouts]);

  return {
    events,
    stats,
    isPaused,
    isConnected,
    selectedEvent,
    droppedCount,
    togglePause,
    selectEvent,
    triggerTestFlow,
    testFlowLoading,
  };
}

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { testEventFlow } from "@/api/overview/events";

import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaEventStatus } from '@/lib/bindings/PersonaEventStatus';
import { useEventPhaseProgressor } from '@/hooks/realtime/useEventPhaseProgressor';

// -- Color Map (from centralized event tokens) ----------
export { EVENT_TYPE_HEX_COLORS } from '@/lib/design/eventTokens';

// -- Types ----------------------------------------------------------
export type AnimationPhase = 'entering' | 'on-bus' | 'delivering' | 'done';

/** Pure event data — no animation metadata */
export interface RealtimeEvent {
  id: string;
  project_id: string;
  event_type: string;
  source_type: string;
  source_id: string | null;
  target_persona_id: string | null;
  payload: string | null;
  status: PersonaEventStatus;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
}

/** Animation state stored separately, keyed by animationId */
export interface AnimationState {
  eventId: string;
  animationId: string;
  phase: AnimationPhase;
  phaseStartedAt: number;
}

export type AnimationMap = Map<string, AnimationState>;

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
  /** Ref to animation state map — read in render via animTick counter */
  animationMapRef: React.RefObject<AnimationMap>;
  /** Increments each time animation state changes, use as dep to re-render */
  animTick: number;
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
    (e) => e.status === 'completed' || e.status === 'delivered'
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

  // Animation state lives in a ref — only the tick counter triggers re-renders
  const animationMapRef = useRef<AnimationMap>(new Map());
  const [animTick, setAnimTick] = useState(0);

  // Stats are tracked separately from animation state — only recomputed when
  // the events array actually changes (add/remove), never on animation ticks.
  const [dataVersion, setDataVersion] = useState(0);
  const statsRef = useRef<RealtimeStats>(computeStats([]));

  const clearPendingTestFlowTimeouts = useCallback(() => {
    for (const timeoutId of testFlowTimeoutsRef.current) {
      clearTimeout(timeoutId);
    }
    testFlowTimeoutsRef.current = [];
  }, []);

  const stats = useMemo(() => statsRef.current, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper: push events and recompute stats in one batch.
  // This is the ONLY way events should be added — it ensures stats stay in sync
  // with the data state and never recompute on animation-only ticks.
  const pushEvent = useCallback((event: RealtimeEvent) => {
    setEvents((prev) => {
      const next = [event, ...prev];
      const capped = next.length > 200 ? next.slice(0, 200) : next;
      if (next.length > 200) {
        setDroppedCount((c) => c + next.length - 200);
      }
      // Recompute stats from the new data state
      statsRef.current = computeStats(capped);
      setDataVersion((v) => v + 1);
      return capped;
    });
  }, []);

  // Helper: register animation state for a new event
  const registerAnimation = useCallback((eventId: string) => {
    const animationId = `${eventId}-${Date.now()}`;
    animationMapRef.current.set(animationId, {
      eventId,
      animationId,
      phase: 'entering',
      phaseStartedAt: Date.now(),
    });
    return animationId;
  }, []);

  // Listen to Tauri 'event-bus' events from backend
  const handleBusEvent = useCallback((raw: PersonaEvent) => {
    if (isPausedRef.current) return;

    registerAnimation(raw.id);
    pushEvent(raw as RealtimeEvent);
  }, [registerAnimation, pushEvent]);
  const isConnected = useEventBusListener(handleBusEvent);

  useEventPhaseProgressor({
    active: !isPaused,
    animationMapRef,
    onTick: setAnimTick,
  });

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
          const simId = `sim-${Date.now()}-${i}`;
          const simEvent: RealtimeEvent = {
            id: simId,
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
          };
          registerAnimation(simId);
          pushEvent(simEvent);
        }, i * 350);
        testFlowTimeoutsRef.current.push(timeoutId);
      }
    } finally {
      setTestFlowLoading(false);
    }
  }, [clearPendingTestFlowTimeouts, registerAnimation, pushEvent]);

  return {
    events,
    stats,
    isPaused,
    isConnected,
    selectedEvent,
    droppedCount,
    animationMapRef,
    animTick,
    togglePause,
    selectEvent,
    triggerTestFlow,
    testFlowLoading,
  };
}

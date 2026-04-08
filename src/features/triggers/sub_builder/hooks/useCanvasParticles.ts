import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { EventEdgeData } from '../edges/EventEdge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvasParticle {
  id: string;
  edgeId: string;
  color: string;
  eventType: string;
  summary: string;
  spawnedAt: number;
}

const PARTICLE_TTL_MS = 2000;
const MAX_PARTICLES_PER_EDGE = 5;
let particleCounter = 0;

// Simple color map for common event types
const EVENT_COLORS: Record<string, string> = {
  build_complete: '#34d399',
  test_passed: '#34d399',
  execution_completed: '#34d399',
  test_failed: '#f87171',
  execution_failed: '#f87171',
  error: '#f87171',
  webhook_received: '#60a5fa',
  cloud_webhook: '#60a5fa',
  schedule_fired: '#fbbf24',
  file_changed: '#22d3ee',
  persona_action: '#a78bfa',
};
const DEFAULT_COLOR = '#a78bfa';

function getParticleColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseCanvasParticlesOpts {
  edges: Edge[];
}

export function useCanvasParticles({ edges }: UseCanvasParticlesOpts) {
  const [particlesByEdge, setParticlesByEdge] = useState<Map<string, CanvasParticle[]>>(new Map());
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Match incoming event to canvas edges
  const matchEvent = useCallback((event: PersonaEvent): string[] => {
    const matchedEdgeIds: string[] = [];
    for (const edge of edgesRef.current) {
      const d = edge.data as EventEdgeData | undefined;
      if (!d?.eventType) continue;
      if (d.eventType !== event.event_type) continue;

      // Source filter wildcard matching
      if (d.sourceFilter && event.source_id) {
        if (d.sourceFilter.endsWith('*')) {
          const prefix = d.sourceFilter.slice(0, -1);
          if (!event.source_id.startsWith(prefix)) continue;
        } else if (d.sourceFilter !== event.source_id) {
          continue;
        }
      }

      matchedEdgeIds.push(edge.id);
    }
    return matchedEdgeIds;
  }, []);

  // Handle incoming event
  useEventBusListener(useCallback((event: PersonaEvent) => {
    const matched = matchEvent(event);
    if (matched.length === 0) return;

    const now = Date.now();
    const color = getParticleColor(event.event_type);
    const summary = event.payload?.slice(0, 80) ?? event.event_type;

    setParticlesByEdge(prev => {
      const next = new Map(prev);
      for (const edgeId of matched) {
        const existing = next.get(edgeId) ?? [];
        // Cap particles per edge
        const trimmed = existing.length >= MAX_PARTICLES_PER_EDGE
          ? existing.slice(1)
          : existing;

        const particle: CanvasParticle = {
          id: `p-${++particleCounter}`,
          edgeId,
          color,
          eventType: event.event_type,
          summary,
          spawnedAt: now,
        };
        next.set(edgeId, [...trimmed, particle]);
      }
      return next;
    });
  }, [matchEvent]));

  // Expire old particles
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setParticlesByEdge(prev => {
        let changed = false;
        const next = new Map<string, CanvasParticle[]>();
        for (const [edgeId, particles] of prev) {
          const alive = particles.filter(p => now - p.spawnedAt < PARTICLE_TTL_MS);
          if (alive.length !== particles.length) changed = true;
          if (alive.length > 0) next.set(edgeId, alive);
          else if (particles.length > 0) changed = true;
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return { particlesByEdge };
}

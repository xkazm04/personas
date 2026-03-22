import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import type { ProcessingInfo, ReturnFlow, DiscoveredSource } from './libs/visualizationHelpers';
import {
  CX, CY, TOOL_RING_R, PERSONA_RING_R,
  FADE_AFTER_MS, RETURN_FLOW_MS,
  colorForSource, labelForSource,
  DEFAULT_TOOLS, DEFAULT_PERSONAS,
  distributeOnRing,
} from './libs/visualizationHelpers';
import type { PersonaInfo } from './event_bus/state/EventBusTypes';

// ── Hook: all state logic for EventBusVisualization ──────────────

export function useEventBusState(events: RealtimeEvent[], personas: PersonaInfo[]) {
  // ── Discovered source topology ──
  const discoveredSourcesRef = useRef(new Map<string, DiscoveredSource>());

  useEffect(() => {
    const map = discoveredSourcesRef.current;
    const now = Date.now();
    for (const evt of events) {
      const key = evt.source_id || evt.source_type || 'unknown';
      if (!key || key === 'unknown') continue;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        existing.lastSeen = now;
      } else {
        map.set(key, { id: key, label: labelForSource(key), count: 1, lastSeen: now });
      }
    }
    // Prune stale sources (not seen in 10 min) and cap at 100 entries
    const STALE_MS = 10 * 60 * 1000;
    if (map.size > 100) {
      for (const [k, v] of map) {
        if (now - v.lastSeen > STALE_MS) map.delete(k);
      }
    }
    if (map.size > 100) {
      const sorted = [...map.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      for (let i = 0; i < sorted.length - 100; i++) map.delete(sorted[i]![0]);
    }
  }, [events]);

  // ── Build rings ──
  const toolNodes = useMemo(() => {
    const discovered = discoveredSourcesRef.current;
    if (discovered.size === 0) return distributeOnRing(DEFAULT_TOOLS, TOOL_RING_R);
    const now = Date.now();
    const sources = Array.from(discovered.values()).sort((a, b) => b.count - a.count).slice(0, 16);
    const maxCount = Math.max(1, ...sources.map(s => s.count));
    const raw = sources.map(s => {
      const age = now - s.lastSeen;
      const sizeFactor = 0.3 + 0.7 * (s.count / maxCount);
      return {
        id: s.id, label: s.label, icon: null,
        color: colorForSource(s.id),
        sizeFactor: age > FADE_AFTER_MS ? sizeFactor * 0.5 : sizeFactor,
      };
    });
    return distributeOnRing(raw, TOOL_RING_R);
  }, [events.length]); // deps intentionally limited to events.length

  const personaNodes = useMemo(() => {
    const raw = personas.length > 0
      ? personas.slice(0, 12).map((p) => ({ id: p.id, label: p.name, icon: p.icon, color: p.color ?? '#8b5cf6' }))
      : DEFAULT_PERSONAS;
    const offset = Math.PI / Math.max(raw.length, 1);
    return distributeOnRing(raw, PERSONA_RING_R, offset);
  }, [personas]);

  // ── Position maps ──
  const toolPositionMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of toolNodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [toolNodes]);

  const personaPositionMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of personaNodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [personaNodes]);

  // ── Active events + seen types ──
  const { activeEvents, seenTypes, inFlightCount } = useMemo(() => {
    const active: RealtimeEvent[] = [];
    const types = new Set<string>();
    for (const e of events) {
      types.add(e.event_type);
      if (e._phase !== 'done') active.push(e);
    }
    return { activeEvents: active, seenTypes: [...types], inFlightCount: active.length };
  }, [events]);

  // ── Source / target helpers ──
  const getSourcePos = useCallback((evt: RealtimeEvent) => {
    const sourceKey = evt.source_id || evt.source_type;
    if (sourceKey) {
      const p = toolPositionMap.get(sourceKey) ?? toolPositionMap.get(`def:${sourceKey}`);
      if (p) return p;
    }
    const h = (evt.id.charCodeAt(0) + (evt.id.charCodeAt(1) || 0)) * 137.5;
    const a = (h % 360) * (Math.PI / 180);
    return { x: CX + TOOL_RING_R * Math.cos(a), y: CY + TOOL_RING_R * Math.sin(a) };
  }, [toolPositionMap]);

  const getTargetPos = useCallback((evt: RealtimeEvent) => {
    if (evt.target_persona_id) {
      const pos = personaPositionMap.get(evt.target_persona_id);
      if (pos) return pos;
    }
    const idx = evt.id.charCodeAt(0) % personaNodes.length;
    const pn = personaNodes[idx];
    return pn ? { x: pn.x, y: pn.y } : null;
  }, [personaPositionMap, personaNodes]);

  // ── Processing state + return flows ──
  const [processingSet, setProcessingSet] = useState<Map<string, ProcessingInfo>>(new Map());
  const [returnFlows, setReturnFlows] = useState<ReturnFlow[]>([]);
  const spawnedRef = useRef(new Set<string>());
  const timeoutByAnimationIdRef = useRef(new Map<string, number>());

  const clearTrackedTimeouts = useCallback(() => {
    for (const t of timeoutByAnimationIdRef.current.values()) clearTimeout(t);
    timeoutByAnimationIdRef.current.clear();
  }, []);

  useEffect(() => () => { clearTrackedTimeouts(); }, [clearTrackedTimeouts]);

  // Spawn processing + return flow when event reaches persona
  useEffect(() => {
    for (const evt of activeEvents) {
      if (evt._phase !== 'delivering') continue;
      if (spawnedRef.current.has(evt._animationId)) continue;
      spawnedRef.current.add(evt._animationId);
      if (spawnedRef.current.size > 200) {
        spawnedRef.current.clear();
        clearTrackedTimeouts();
      }

      const color = EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8';
      const tgt = getTargetPos(evt);
      const src = getSourcePos(evt);
      if (!tgt) continue;

      const personaId = evt.target_persona_id
        ?? personaNodes[evt.id.charCodeAt(0) % personaNodes.length]?.id
        ?? 'unknown';
      const durationMs = 1200 + Math.random() * 1800;

      setProcessingSet((prev) => {
        const next = new Map(prev);
        next.set(personaId, { color, durationMs, startedAt: Date.now() });
        return next;
      });

      const animationId = evt._animationId;
      const timeoutId = window.setTimeout(() => {
        timeoutByAnimationIdRef.current.delete(animationId);
        setProcessingSet((prev) => { const next = new Map(prev); next.delete(personaId); return next; });
        setReturnFlows((prev) => {
          const next = [
            ...prev,
            { id: `ret-${animationId}`, fromX: tgt.x, fromY: tgt.y, toX: src.x, toY: src.y, color, startedAt: Date.now() },
          ];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
      }, durationMs);
      timeoutByAnimationIdRef.current.set(animationId, timeoutId);
    }
  }, [activeEvents, clearTrackedTimeouts, getSourcePos, getTargetPos, personaNodes]);

  // Prune finished return flows
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setReturnFlows((prev) => {
        const next = prev.filter((f) => now - f.startedAt < RETURN_FLOW_MS);
        return next.length !== prev.length ? next : prev;
      });
    }, 300);
    return () => clearInterval(timer);
  }, []);

  const hasTraffic = activeEvents.length > 0 || returnFlows.length > 0 || processingSet.size > 0;

  return {
    discoveredSourcesRef,
    toolNodes,
    personaNodes,
    activeEvents,
    seenTypes,
    inFlightCount,
    getSourcePos,
    getTargetPos,
    processingSet,
    returnFlows,
    hasTraffic,
  };
}

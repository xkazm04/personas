import { useMemo, useRef, useEffect, useState, useCallback, useId } from 'react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import type { ProcessingInfo, ReturnFlow, DiscoveredSource } from '../../libs/visualizationHelpers';
import {
  CX, CY, FADE_AFTER_MS, RETURN_FLOW_MS,
  colorForSource, labelForSource,
  DEFAULT_TOOLS, DEFAULT_PERSONAS, EVENT_TYPE_LABELS,
  distributeOnRing,
} from '../../libs/visualizationHelpers';
import EventLogSidebar from '../panels/EventLogSidebar';
import type { Props } from '../renderers/EventBusTypes';
import { ORBIT_R_OUTER, ORBIT_R_INNER } from '../renderers/EventBusTypes';
import { EventBusSvgDefs, EventBusCoreElements } from '../renderers/EventBusSvgScene';
import { OuterNodeGroup, InnerNodeGroup } from '../renderers/EventBusNodeRenderers';
import { InboundCometTrails, ReturnFlowComets } from '../renderers/EventBusParticleRenderers';
import { useAnimatedEvents } from '@/hooks/realtime/useAnimatedEvents';
import { useTranslation } from '@/i18n/useTranslation';

export default function EventBusVisualization({ events, personas, animationMapRef, animTick, onSelectEvent }: Props) {
  const { t } = useTranslation();
  const uid = useId();

  /* ---------- source topology ---------- */
  const discoveredRef = useRef(new Map<string, DiscoveredSource>());

  useEffect(() => {
    const map = discoveredRef.current;
    for (const evt of events) {
      const key = evt.source_id || evt.source_type || 'unknown';
      if (key === 'unknown') continue;
      const existing = map.get(key);
      if (existing) { existing.count++; existing.lastSeen = Date.now(); }
      else { map.set(key, { id: key, label: labelForSource(key), count: 1, lastSeen: Date.now() }); }
    }
  }, [events]);

  const outerNodes = useMemo(() => {
    const disc = discoveredRef.current;
    if (disc.size === 0) return distributeOnRing(DEFAULT_TOOLS, ORBIT_R_OUTER);
    const now = Date.now();
    const sources = Array.from(disc.values()).sort((a, b) => b.count - a.count).slice(0, 14);
    const maxC = Math.max(1, ...sources.map(s => s.count));
    const raw = sources.map(s => {
      const age = now - s.lastSeen;
      const sf = 0.3 + 0.7 * (s.count / maxC);
      return { id: s.id, label: s.label, icon: null, color: colorForSource(s.id), sizeFactor: age > FADE_AFTER_MS ? sf * 0.5 : sf };
    });
    return distributeOnRing(raw, ORBIT_R_OUTER);
  }, [events.length]);

  const innerNodes = useMemo(() => {
    const raw = personas.length > 0
      ? personas.slice(0, 10).map(p => ({ id: p.id, label: p.name, icon: p.icon, color: p.color ?? '#8b5cf6' }))
      : DEFAULT_PERSONAS;
    return distributeOnRing(raw, ORBIT_R_INNER, Math.PI / Math.max(raw.length, 1));
  }, [personas]);

  /* ---------- position lookup ---------- */
  const outerMap = useMemo(() => { const m = new Map<string, { x: number; y: number }>(); for (const n of outerNodes) m.set(n.id, { x: n.x, y: n.y }); return m; }, [outerNodes]);
  const innerMap = useMemo(() => { const m = new Map<string, { x: number; y: number }>(); for (const n of innerNodes) m.set(n.id, { x: n.x, y: n.y }); return m; }, [innerNodes]);

  const animatedEvents = useAnimatedEvents(events, animationMapRef.current, animTick);

  const { seenTypes, inFlightCount } = useMemo(() => {
    const types = new Set<string>();
    for (const e of events) types.add(e.event_type);
    return { seenTypes: [...types], inFlightCount: animatedEvents.length };
  }, [events, animatedEvents.length]);

  const getSrc = useCallback((evt: RealtimeEvent) => {
    const key = evt.source_id || evt.source_type;
    if (key) { const p = outerMap.get(key) ?? outerMap.get(`def:${key}`); if (p) return p; }
    const h = (evt.id.charCodeAt(0) + (evt.id.charCodeAt(1) || 0)) * 137.5;
    const a = (h % 360) * (Math.PI / 180);
    return { x: CX + ORBIT_R_OUTER * Math.cos(a), y: CY + ORBIT_R_OUTER * Math.sin(a) };
  }, [outerMap]);

  const getTgt = useCallback((evt: RealtimeEvent) => {
    if (evt.target_persona_id) { const pos = innerMap.get(evt.target_persona_id); if (pos) return pos; }
    const idx = evt.id.charCodeAt(0) % innerNodes.length;
    const pn = innerNodes[idx];
    return pn ? { x: pn.x, y: pn.y } : null;
  }, [innerMap, innerNodes]);

  /* ---------- processing / return flows ---------- */
  const [processingSet, setProcessingSet] = useState<Map<string, ProcessingInfo>>(new Map());
  const [returnFlows, setReturnFlows] = useState<ReturnFlow[]>([]);
  const spawnedRef = useRef(new Set<string>());
  const timeoutRef = useRef(new Map<string, number>());

  const clearTimeouts = useCallback(() => { for (const t of timeoutRef.current.values()) clearTimeout(t); timeoutRef.current.clear(); }, []);
  useEffect(() => () => { clearTimeouts(); }, [clearTimeouts]);

  useEffect(() => {
    for (const { event: evt, animationId, phase } of animatedEvents) {
      if (phase !== 'delivering' || spawnedRef.current.has(animationId)) continue;
      spawnedRef.current.add(animationId);
      if (spawnedRef.current.size > 200) { spawnedRef.current.clear(); clearTimeouts(); }
      const color = EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8';
      const tgt = getTgt(evt); const src = getSrc(evt);
      if (!tgt) continue;
      const personaId = evt.target_persona_id ?? innerNodes[evt.id.charCodeAt(0) % innerNodes.length]?.id ?? 'unknown';
      const durationMs = 1200 + Math.random() * 1800;
      setProcessingSet(prev => { const next = new Map(prev); next.set(personaId, { color, durationMs, startedAt: Date.now() }); return next; });
      const tid = window.setTimeout(() => {
        timeoutRef.current.delete(animationId);
        setProcessingSet(prev => { const next = new Map(prev); next.delete(personaId); return next; });
        setReturnFlows(prev => {
          const next = [...prev, { id: `ret-${animationId}`, fromX: tgt.x, fromY: tgt.y, toX: src.x, toY: src.y, color, startedAt: Date.now() }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
      }, durationMs);
      timeoutRef.current.set(animationId, tid);
    }
  }, [animatedEvents, clearTimeouts, getSrc, getTgt, innerNodes]);

  // Only run the cleanup timer when there are active return flows to expire.
  const hasReturnFlows = returnFlows.length > 0;
  useEffect(() => {
    if (!hasReturnFlows) return;
    const t = setInterval(() => {
      const now = Date.now();
      setReturnFlows(prev => { const next = prev.filter(f => now - f.startedAt < RETURN_FLOW_MS); return next.length !== prev.length ? next : prev; });
    }, 300);
    return () => clearInterval(t);
  }, [hasReturnFlows]);

  const hasTraffic = animatedEvents.length > 0 || returnFlows.length > 0 || processingSet.size > 0;

  return (
    <div className="w-full h-full flex min-h-[280px]">
      <div className="flex-1 relative">
        <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <EventBusSvgDefs uid={uid} hasTraffic={hasTraffic} />
          <EventBusCoreElements uid={uid} hasTraffic={hasTraffic} />
          <OuterNodeGroup nodes={outerNodes} />
          <InnerNodeGroup nodes={innerNodes} processingSet={processingSet} hasTraffic={hasTraffic} />
          <InboundCometTrails activeEvents={animatedEvents} uid={uid} getSrc={getSrc} getTgt={getTgt} onSelectEvent={onSelectEvent} />
          <ReturnFlowComets flows={returnFlows} uid={uid} />

          {/* Badges */}
          <rect x={72} y={91} width={24} height={5} rx={2.5} fill="rgba(139,92,246,0.06)" stroke="rgba(139,92,246,0.12)" strokeWidth="0.3" />
          <text x={84} y={93.8} textAnchor="middle" dominantBaseline="middle" fill={inFlightCount > 0 ? 'rgba(139,92,246,0.9)' : 'rgba(139,92,246,0.4)'} fontSize="2" fontFamily="monospace" letterSpacing="0.05em">{inFlightCount} in-flight</text>
          <rect x={4} y={91} width={24} height={5} rx={2.5} fill="rgba(6,182,212,0.06)" stroke="rgba(6,182,212,0.12)" strokeWidth="0.3" />
          <text x={16} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(6,182,212,0.6)" fontSize="2" fontFamily="monospace" letterSpacing="0.05em">{innerNodes.length} agents</text>
        </svg>

        {/* Legend */}
        {seenTypes.length > 0 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-background/70 backdrop-blur-md border border-purple-500/15 rounded-2xl px-4 py-2 flex items-center gap-3">
            {seenTypes.slice(0, 6).map(type => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: EVENT_TYPE_HEX_COLORS[type] ?? '#818cf8' }} />
                  <span className="typo-code font-mono text-foreground">{EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}</span>
                </div>
              ))}
          </div>
        )}

        {events.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 bg-background/40 backdrop-blur-sm border border-purple-500/10 rounded-2xl px-6 py-4">
              <span className="typo-code text-foreground font-mono">{t.overview.realtime_idle.idle}</span>
              <span className="typo-caption text-foreground">Click <span className="text-purple-400/60 font-medium">{t.overview.realtime_stats.test_flow}</span> {t.overview.realtime_stats.to_simulate_traffic}</span>
            </div>
          </div>
        )}
      </div>

      <EventLogSidebar events={events} onSelectEvent={onSelectEvent} />
    </div>
  );
}

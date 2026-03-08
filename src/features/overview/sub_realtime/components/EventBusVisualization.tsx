import { useMemo, useRef, useEffect, useState, useCallback, useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import type { ProcessingInfo, ReturnFlow, DiscoveredSource } from '../libs/visualizationHelpers';
import {
  CX, CY, TOOL_RING_R, PERSONA_RING_R, CORE_OUTER_R, CORE_INNER_R,
  FADE_AFTER_MS, RETURN_FLOW_MS,
  colorForSource, labelForSource,
  DEFAULT_TOOLS, DEFAULT_PERSONAS, EVENT_TYPE_LABELS,
  distributeOnRing,
} from '../libs/visualizationHelpers';
import { ToolNodeGroup, PersonaNodeGroup } from './VisualizationNodes';
import { InboundParticles, ReturnFlowParticles } from './VisualizationParticles';

interface PersonaInfo {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  events: RealtimeEvent[];
  personas: PersonaInfo[];
  droppedCount?: number;
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

export default function EventBusVisualization({ events, personas, droppedCount = 0, onSelectEvent }: Props) {
  const uid = useId();

  // -- Discovered source topology --
  const discoveredSourcesRef = useRef(new Map<string, DiscoveredSource>());

  useEffect(() => {
    const map = discoveredSourcesRef.current;
    for (const evt of events) {
      const key = evt.source_id || evt.source_type || 'unknown';
      if (!key || key === 'unknown') continue;
      const existing = map.get(key);
      if (existing) { existing.count++; existing.lastSeen = Date.now(); }
      else { map.set(key, { id: key, label: labelForSource(key), count: 1, lastSeen: Date.now() }); }
    }
  }, [events]);

  const toolNodes = useMemo(() => {
    const discovered = discoveredSourcesRef.current;
    if (discovered.size === 0) return distributeOnRing(DEFAULT_TOOLS, TOOL_RING_R);
    const now = Date.now();
    const sources = Array.from(discovered.values()).sort((a, b) => b.count - a.count).slice(0, 16);
    const maxCount = Math.max(1, ...sources.map(s => s.count));
    const raw = sources.map(s => {
      const age = now - s.lastSeen;
      const sizeFactor = 0.3 + 0.7 * (s.count / maxCount);
      return { id: s.id, label: s.label, icon: null, color: colorForSource(s.id), sizeFactor: age > FADE_AFTER_MS ? sizeFactor * 0.5 : sizeFactor };
    });
    return distributeOnRing(raw, TOOL_RING_R);
  }, [events.length]);

  const personaNodes = useMemo(() => {
    const raw = personas.length > 0
      ? personas.slice(0, 12).map((p) => ({ id: p.id, label: p.name, icon: p.icon, color: p.color ?? '#8b5cf6' }))
      : DEFAULT_PERSONAS;
    const offset = Math.PI / Math.max(raw.length, 1);
    return distributeOnRing(raw, PERSONA_RING_R, offset);
  }, [personas]);

  // -- Position maps --
  const toolPositionMap = useMemo(() => { const m = new Map<string, { x: number; y: number }>(); for (const n of toolNodes) m.set(n.id, { x: n.x, y: n.y }); return m; }, [toolNodes]);
  const personaPositionMap = useMemo(() => { const m = new Map<string, { x: number; y: number }>(); for (const n of personaNodes) m.set(n.id, { x: n.x, y: n.y }); return m; }, [personaNodes]);

  const { activeEvents, seenTypes, inFlightCount } = useMemo(() => {
    const active: RealtimeEvent[] = []; const types = new Set<string>();
    for (const e of events) { types.add(e.event_type); if (e._phase !== 'done') active.push(e); }
    return { activeEvents: active, seenTypes: [...types], inFlightCount: active.length };
  }, [events]);

  const getSourcePos = useCallback((evt: RealtimeEvent) => {
    const sourceKey = evt.source_id || evt.source_type;
    if (sourceKey) { const p = toolPositionMap.get(sourceKey) ?? toolPositionMap.get(`def:${sourceKey}`); if (p) return p; }
    const h = (evt.id.charCodeAt(0) + (evt.id.charCodeAt(1) || 0)) * 137.5;
    const a = (h % 360) * (Math.PI / 180);
    return { x: CX + TOOL_RING_R * Math.cos(a), y: CY + TOOL_RING_R * Math.sin(a) };
  }, [toolPositionMap]);

  const getTargetPos = useCallback((evt: RealtimeEvent) => {
    if (evt.target_persona_id) { const pos = personaPositionMap.get(evt.target_persona_id); if (pos) return pos; }
    const idx = evt.id.charCodeAt(0) % personaNodes.length;
    const pn = personaNodes[idx];
    return pn ? { x: pn.x, y: pn.y } : null;
  }, [personaPositionMap, personaNodes]);

  // -- Processing state + return flows --
  const [processingSet, setProcessingSet] = useState<Map<string, ProcessingInfo>>(new Map());
  const [returnFlows, setReturnFlows] = useState<ReturnFlow[]>([]);
  const spawnedRef = useRef(new Set<string>());
  const timeoutByAnimationIdRef = useRef(new Map<string, number>());

  const clearTrackedTimeouts = useCallback(() => { for (const t of timeoutByAnimationIdRef.current.values()) clearTimeout(t); timeoutByAnimationIdRef.current.clear(); }, []);
  useEffect(() => () => { clearTrackedTimeouts(); }, [clearTrackedTimeouts]);

  useEffect(() => {
    for (const evt of activeEvents) {
      if (evt._phase !== 'delivering') continue;
      if (spawnedRef.current.has(evt._animationId)) continue;
      spawnedRef.current.add(evt._animationId);
      if (spawnedRef.current.size > 200) { spawnedRef.current.clear(); clearTrackedTimeouts(); }
      const color = EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8';
      const tgt = getTargetPos(evt); const src = getSourcePos(evt);
      if (!tgt) continue;
      const personaId = evt.target_persona_id ?? personaNodes[evt.id.charCodeAt(0) % personaNodes.length]?.id ?? 'unknown';
      const durationMs = 1200 + Math.random() * 1800;
      setProcessingSet((prev) => { const next = new Map(prev); next.set(personaId, { color, durationMs, startedAt: Date.now() }); return next; });
      const animationId = evt._animationId;
      const timeoutId = window.setTimeout(() => {
        timeoutByAnimationIdRef.current.delete(animationId);
        setProcessingSet((prev) => { const next = new Map(prev); next.delete(personaId); return next; });
        setReturnFlows((prev) => {
          const next = [...prev, { id: `ret-${animationId}`, fromX: tgt.x, fromY: tgt.y, toX: src.x, toY: src.y, color, startedAt: Date.now() }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
      }, durationMs);
      timeoutByAnimationIdRef.current.set(animationId, timeoutId);
    }
  }, [activeEvents, clearTrackedTimeouts, getSourcePos, getTargetPos, personaNodes]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setReturnFlows((prev) => { const next = prev.filter((f) => now - f.startedAt < RETURN_FLOW_MS); return next.length !== prev.length ? next : prev; });
    }, 300);
    return () => clearInterval(timer);
  }, []);

  const hasTraffic = activeEvents.length > 0 || returnFlows.length > 0 || processingSet.size > 0;

  return (
    <div className="w-full h-full relative min-h-[280px]">
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id={`${uid}-glow`}><feGaussianBlur stdDeviation="1.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id={`${uid}-pGlow`}><feGaussianBlur stdDeviation="0.6" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id={`${uid}-coreGrad`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={hasTraffic ? 'rgba(6,182,212,0.4)' : 'rgba(6,182,212,0.2)'} />
            <stop offset="40%" stopColor={hasTraffic ? 'rgba(168,85,247,0.2)' : 'rgba(168,85,247,0.08)'} />
            <stop offset="100%" stopColor="rgba(6,182,212,0)" />
          </radialGradient>
        </defs>

        {/* Central Core */}
        <circle cx={CX} cy={CY} r={CORE_OUTER_R} fill={`url(#${uid}-coreGrad)`} />
        <circle cx={CX} cy={CY} r={CORE_INNER_R} fill="rgba(255,255,255,0.03)" stroke={hasTraffic ? 'rgba(6,182,212,0.4)' : 'rgba(6,182,212,0.15)'} strokeWidth="0.4" className="transition-all duration-700" />
        <circle cx={CX} cy={CY} r={CORE_INNER_R + 2} fill="none" stroke="rgba(6,182,212,0.08)" strokeWidth="0.15">
          <animate attributeName="r" values={`${CORE_INNER_R + 1};${CORE_INNER_R + 2.5};${CORE_INNER_R + 1}`} dur="5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.12;0.03;0.12" dur="5s" repeatCount="indefinite" />
        </circle>
        <text x={CX} y={CY + 0.6} textAnchor="middle" dominantBaseline="middle" fill={hasTraffic ? 'rgba(6,182,212,0.8)' : 'rgba(6,182,212,0.4)'} fontSize="2.4" fontFamily="monospace" letterSpacing="0.15em" className="transition-all duration-700">BUS</text>

        <ToolNodeGroup nodes={toolNodes} />
        <PersonaNodeGroup nodes={personaNodes} processingSet={processingSet} />
        <InboundParticles activeEvents={activeEvents} uid={uid} getSourcePos={getSourcePos} getTargetPos={getTargetPos} onSelectEvent={onSelectEvent} />
        <ReturnFlowParticles flows={returnFlows} uid={uid} />

        {/* Badges */}
        <rect x={72} y={91} width={24} height={5} rx={2.5} fill="rgba(6,182,212,0.08)" stroke="rgba(6,182,212,0.15)" strokeWidth="0.3" />
        <text x={84} y={93.8} textAnchor="middle" dominantBaseline="middle" fill={inFlightCount > 0 ? 'rgba(6,182,212,0.9)' : 'rgba(6,182,212,0.4)'} fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">{inFlightCount} in-flight</text>
        {discoveredSourcesRef.current.size > 0 && (
          <>
            <rect x={38} y={91} width={24} height={5} rx={2.5} fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.15)" strokeWidth="0.3" />
            <text x={50} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(245,158,11,0.6)" fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">{discoveredSourcesRef.current.size} sources</text>
          </>
        )}
        <rect x={4} y={91} width={24} height={5} rx={2.5} fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.15)" strokeWidth="0.3" />
        <text x={16} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(168,85,247,0.6)" fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">{personaNodes.length} agents</text>
      </svg>

      {/* Legend */}
      {seenTypes.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm border border-primary/10 rounded-xl px-3 py-2 flex items-center gap-3">
          <AnimatePresence initial={false}>
            {seenTypes.slice(0, 6).map((type) => (
              <motion.div key={type} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.2 }} className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: EVENT_TYPE_HEX_COLORS[type] ?? '#818cf8' }} />
                <span className="text-sm font-mono text-muted-foreground/80">{EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {droppedCount > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 flex-shrink-0" />
            <span className="text-xs font-mono text-amber-300/80">{droppedCount.toLocaleString()} earlier event{droppedCount !== 1 ? 's' : ''} not shown</span>
          </div>
        </div>
      )}

      {events.length === 0 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-background/60 backdrop-blur-sm border border-primary/10 rounded-xl px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan/40" />
            <span className="text-sm text-muted-foreground/60">Idle — click <span className="font-medium text-purple-300/80">Test Flow</span> to simulate traffic</span>
          </div>
        </div>
      )}
    </div>
  );
}

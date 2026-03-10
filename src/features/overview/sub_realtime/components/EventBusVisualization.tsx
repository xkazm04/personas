import { useMemo, useRef, useEffect, useState, useCallback, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import type { ProcessingInfo, ReturnFlow, DiscoveredSource } from '../libs/visualizationHelpers';
import {
  CX, CY, FADE_AFTER_MS, RETURN_FLOW_MS,
  colorForSource, labelForSource,
  DEFAULT_TOOLS, DEFAULT_PERSONAS, EVENT_TYPE_LABELS,
  distributeOnRing, iconChar, clampLabel,
} from '../libs/visualizationHelpers';
import EventLogSidebar from './EventLogSidebar';

/* ---------- Layout constants ---------- */
const ORBIT_R_OUTER = 44;
const ORBIT_R_INNER = 22;
const NODE_R = 3.2;
const CORE_R = 8;
const TRAIL_DURATION = 1.2;
const COMET_TAIL_STEPS = 6;

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

export default function EventBusVisualization({ events, personas, onSelectEvent }: Props) {
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

  const { activeEvents, seenTypes, inFlightCount } = useMemo(() => {
    const active: RealtimeEvent[] = []; const types = new Set<string>();
    for (const e of events) { types.add(e.event_type); if (e._phase !== 'done') active.push(e); }
    return { activeEvents: active, seenTypes: [...types], inFlightCount: active.length };
  }, [events]);

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
    for (const evt of activeEvents) {
      if (evt._phase !== 'delivering' || spawnedRef.current.has(evt._animationId)) continue;
      spawnedRef.current.add(evt._animationId);
      if (spawnedRef.current.size > 200) { spawnedRef.current.clear(); clearTimeouts(); }
      const color = EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8';
      const tgt = getTgt(evt); const src = getSrc(evt);
      if (!tgt) continue;
      const personaId = evt.target_persona_id ?? innerNodes[evt.id.charCodeAt(0) % innerNodes.length]?.id ?? 'unknown';
      const durationMs = 1200 + Math.random() * 1800;
      setProcessingSet(prev => { const next = new Map(prev); next.set(personaId, { color, durationMs, startedAt: Date.now() }); return next; });
      const animId = evt._animationId;
      const tid = window.setTimeout(() => {
        timeoutRef.current.delete(animId);
        setProcessingSet(prev => { const next = new Map(prev); next.delete(personaId); return next; });
        setReturnFlows(prev => {
          const next = [...prev, { id: `ret-${animId}`, fromX: tgt.x, fromY: tgt.y, toX: src.x, toY: src.y, color, startedAt: Date.now() }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
      }, durationMs);
      timeoutRef.current.set(animId, tid);
    }
  }, [activeEvents, clearTimeouts, getSrc, getTgt, innerNodes]);

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setReturnFlows(prev => { const next = prev.filter(f => now - f.startedAt < RETURN_FLOW_MS); return next.length !== prev.length ? next : prev; });
    }, 300);
    return () => clearInterval(t);
  }, []);

  const hasTraffic = activeEvents.length > 0 || returnFlows.length > 0 || processingSet.size > 0;

  return (
    <div className="w-full h-full flex min-h-[280px]">
      {/* Main visualization */}
      <div className="flex-1 relative">
        <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id={`${uid}-softGlow`}>
              <feGaussianBlur stdDeviation="0.8" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id={`${uid}-cometGlow`}>
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <radialGradient id={`${uid}-nebula`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={hasTraffic ? 'rgba(139,92,246,0.30)' : 'rgba(139,92,246,0.10)'} />
              <stop offset="50%" stopColor="rgba(6,182,212,0.05)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <radialGradient id={`${uid}-coreGlow`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
              <stop offset="40%" stopColor="rgba(139,92,246,0.1)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
          </defs>

          {/* Nebula core */}
          <circle cx={CX} cy={CY} r={28} fill={`url(#${uid}-nebula)`} />

          {/* Orbit rings */}
          <circle cx={CX} cy={CY} r={ORBIT_R_OUTER} fill="none" stroke="rgba(139,92,246,0.06)" strokeWidth="0.15" strokeDasharray="1 2" />
          <circle cx={CX} cy={CY} r={ORBIT_R_INNER} fill="none" stroke="rgba(6,182,212,0.08)" strokeWidth="0.15" strokeDasharray="0.8 1.5" />

          {/* Central hub */}
          <circle cx={CX} cy={CY} r={CORE_R + 4} fill={`url(#${uid}-coreGlow)`} />
          <circle cx={CX} cy={CY} r={CORE_R} fill="rgba(255,255,255,0.02)" stroke={hasTraffic ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.2)'} strokeWidth="0.3" className="transition-all duration-700" />
          <circle cx={CX} cy={CY} r={CORE_R * 0.45} fill="rgba(139,92,246,0.25)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.15" className="transition-all duration-700" />
          <text x={CX} y={CY + 0.5} textAnchor="middle" dominantBaseline="middle" fill={hasTraffic ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)'} fontSize="2" fontFamily="monospace" letterSpacing="0.2em" className="transition-all duration-700">HUB</text>

          {/* Outer nodes (sources) — diamond shapes */}
          {outerNodes.map(node => {
            const sf = node.sizeFactor ?? 1;
            const isDisc = !node.id.startsWith('def:');
            const r = isDisc ? 2.2 + sf * 1.6 : NODE_R;
            const opacity = isDisc ? 0.5 + sf * 0.5 : 0.35;
            return (
              <g key={node.id} opacity={opacity}>
                <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={node.color} strokeWidth="0.06" opacity={0.15} />
                <polygon
                  points={`${node.x},${node.y - r} ${node.x + r * 0.7},${node.y} ${node.x},${node.y + r} ${node.x - r * 0.7},${node.y}`}
                  fill={`${node.color}20`} stroke={node.color} strokeWidth={isDisc ? 0.25 : 0.15}
                />
                <circle cx={node.x} cy={node.y} r={r * 0.3} fill={node.color} opacity={0.6} />
                <text x={node.x} y={node.y + r + 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="1.3" fontFamily="monospace">
                  {clampLabel(node.label, 8)}
                </text>
              </g>
            );
          })}

          {/* Inner nodes (personas) — hexagonal with halo */}
          {innerNodes.map((node, i) => {
            const r = 3.5;
            const proc = processingSet.get(node.id);
            const hex = Array.from({ length: 6 }, (_, j) => {
              const a = (j * 60 - 30) * (Math.PI / 180);
              return `${node.x + r * Math.cos(a)},${node.y + r * Math.sin(a)}`;
            }).join(' ');
            return (
              <g key={node.id}>
                <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={node.color} strokeWidth="0.06" opacity={0.08} />
                <circle cx={node.x} cy={node.y} r={r + 1.5} fill="none" stroke={node.color} strokeWidth="0.08" opacity={hasTraffic ? 0.12 : 0.04}>
                  <animate attributeName="r" values={`${r + 0.8};${r + 2};${r + 0.8}`} dur={`${3.5 + i % 3}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values={`${hasTraffic ? 0.12 : 0.04};0.02;${hasTraffic ? 0.12 : 0.04}`} dur={`${3.5 + i % 3}s`} repeatCount="indefinite" />
                </circle>
                <polygon points={hex} fill={`${node.color}18`} stroke={node.color} strokeWidth="0.25" />
                <circle cx={node.x} cy={node.y} r={r * 0.4} fill={node.color} opacity={0.5} />
                <text x={node.x} y={node.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.85)" fontSize="2.6" fontFamily="monospace">
                  {iconChar(node)}
                </text>
                <text x={node.x} y={node.y + r + 2.2} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="1.4" fontFamily="monospace" fontWeight="500">
                  {clampLabel(node.label, 10)}
                </text>
                {proc && (
                  <g>
                    <circle cx={node.x} cy={node.y} r={r + 1.2} fill="none" stroke={`${proc.color}25`} strokeWidth="0.4" />
                    <motion.circle
                      cx={node.x} cy={node.y} r={r + 1.2}
                      fill="none" stroke={proc.color} strokeWidth="0.5" strokeLinecap="round"
                      style={{ strokeDasharray: 2 * Math.PI * (r + 1.2), transformOrigin: `${node.x}px ${node.y}px`, transform: 'rotate(-90deg)' }}
                      initial={{ strokeDashoffset: 2 * Math.PI * (r + 1.2) }}
                      animate={{ strokeDashoffset: 0 }}
                      transition={{ duration: proc.durationMs / 1000, ease: 'linear' }}
                    />
                  </g>
                )}
              </g>
            );
          })}

          {/* Comet-trail particles (inbound) */}
          {activeEvents.map(evt => {
            const src = getSrc(evt);
            const tgt = getTgt(evt);
            const color = evt.status === 'failed' ? '#ef4444' : (EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8');
            const isDone = evt._phase === 'done';
            let tx: number, ty: number;
            switch (evt._phase) {
              case 'entering': case 'on-bus': tx = CX; ty = CY; break;
              case 'delivering': default: tx = tgt?.x ?? CX; ty = tgt?.y ?? CY;
            }
            return (
              <g key={evt._animationId} onClick={() => onSelectEvent(evt)} style={{ cursor: 'pointer' }}>
                {Array.from({ length: COMET_TAIL_STEPS }, (_, i) => {
                  const delay = i * 0.06;
                  const scale = 1 - (i / COMET_TAIL_STEPS);
                  return (
                    <motion.circle
                      key={i}
                      initial={{ cx: src.x, cy: src.y }}
                      animate={{ cx: tx, cy: ty, opacity: isDone ? 0 : scale * 0.25 }}
                      transition={{ duration: TRAIL_DURATION + delay, ease: 'easeInOut' }}
                      r={0.6 + scale * 0.8} fill={color}
                    />
                  );
                })}
                <motion.circle
                  initial={{ cx: src.x, cy: src.y }}
                  animate={{ cx: tx, cy: ty, opacity: isDone ? 0 : 1 }}
                  transition={{ duration: TRAIL_DURATION, ease: 'easeInOut' }}
                  r={1.3} fill={color} filter={`url(#${uid}-cometGlow)`}
                />
                <motion.circle
                  initial={{ cx: src.x, cy: src.y }}
                  animate={{ cx: tx, cy: ty, opacity: isDone ? 0 : 0.95 }}
                  transition={{ duration: TRAIL_DURATION, ease: 'easeInOut' }}
                  r={0.45} fill="white"
                />
                {evt._phase === 'delivering' && (evt.status === 'completed' || evt.status === 'failed') && (
                  <>
                    <motion.circle
                      initial={{ r: 1.5, opacity: 0.6 }}
                      animate={{ r: 6, opacity: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      cx={tx} cy={ty} fill="none" stroke={color} strokeWidth={0.15}
                    />
                    <motion.circle
                      initial={{ r: 0.8, opacity: 0.4 }}
                      animate={{ r: 4, opacity: 0 }}
                      transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                      cx={tx} cy={ty} fill="none" stroke="white" strokeWidth={0.1}
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* Return flow comets */}
          <AnimatePresence>
            {returnFlows.map(flow => (
              <motion.g key={flow.id} initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {[0.15, 0.25, 0.35].map((op, i) => (
                  <motion.circle
                    key={i} r={0.5 + (2 - i) * 0.2} fill={flow.color} opacity={op}
                    initial={{ cx: flow.fromX, cy: flow.fromY }}
                    animate={{ cx: [flow.fromX, CX, flow.toX], cy: [flow.fromY, CY, flow.toY] }}
                    transition={{ duration: RETURN_FLOW_MS / 1000 + i * 0.05, times: [0, 0.4, 1], ease: 'easeInOut' }}
                  />
                ))}
                <motion.circle
                  r={0.9} fill={flow.color} filter={`url(#${uid}-softGlow)`}
                  initial={{ cx: flow.fromX, cy: flow.fromY, opacity: 0.9 }}
                  animate={{ cx: [flow.fromX, CX, flow.toX], cy: [flow.fromY, CY, flow.toY], opacity: [0.9, 1, 0.6] }}
                  transition={{ duration: RETURN_FLOW_MS / 1000, times: [0, 0.4, 1], ease: 'easeInOut' }}
                />
                <motion.circle
                  r={0.3} fill="white"
                  initial={{ cx: flow.fromX, cy: flow.fromY }}
                  animate={{ cx: [flow.fromX, CX, flow.toX], cy: [flow.fromY, CY, flow.toY] }}
                  transition={{ duration: RETURN_FLOW_MS / 1000, times: [0, 0.4, 1], ease: 'easeInOut' }}
                />
              </motion.g>
            ))}
          </AnimatePresence>

          {/* Badges */}
          <rect x={72} y={91} width={24} height={5} rx={2.5} fill="rgba(139,92,246,0.06)" stroke="rgba(139,92,246,0.12)" strokeWidth="0.3" />
          <text x={84} y={93.8} textAnchor="middle" dominantBaseline="middle" fill={inFlightCount > 0 ? 'rgba(139,92,246,0.9)' : 'rgba(139,92,246,0.4)'} fontSize="2" fontFamily="monospace" letterSpacing="0.05em">{inFlightCount} in-flight</text>
          <rect x={4} y={91} width={24} height={5} rx={2.5} fill="rgba(6,182,212,0.06)" stroke="rgba(6,182,212,0.12)" strokeWidth="0.3" />
          <text x={16} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(6,182,212,0.6)" fontSize="2" fontFamily="monospace" letterSpacing="0.05em">{innerNodes.length} agents</text>
        </svg>

        {/* Legend */}
        {seenTypes.length > 0 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-background/70 backdrop-blur-md border border-purple-500/15 rounded-2xl px-4 py-2 flex items-center gap-3">
            <AnimatePresence initial={false}>
              {seenTypes.slice(0, 6).map(type => (
                <motion.div key={type} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.2 }} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: EVENT_TYPE_HEX_COLORS[type] ?? '#818cf8' }} />
                  <span className="text-sm font-mono text-muted-foreground/80">{EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {events.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 bg-background/40 backdrop-blur-sm border border-purple-500/10 rounded-2xl px-6 py-4">
              <span className="text-sm text-muted-foreground/40 font-mono">Idle</span>
              <span className="text-xs text-muted-foreground/30">Click <span className="text-purple-400/60 font-medium">Test Flow</span> to simulate traffic</span>
            </div>
          </div>
        )}
      </div>

      {/* Event log sidebar */}
      <EventLogSidebar events={events} onSelectEvent={onSelectEvent} />
    </div>
  );
}

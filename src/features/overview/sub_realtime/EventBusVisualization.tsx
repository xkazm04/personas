import { useMemo, useRef, useEffect, useState, useCallback, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';

// ── Types ────────────────────────────────────────────────────────

interface PersonaInfo {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  events: RealtimeEvent[];
  personas: PersonaInfo[];
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

interface SwarmNode {
  id: string;
  label: string;
  icon: string | null;
  color: string;
  x: number;
  y: number;
}

interface ProcessingInfo {
  color: string;
  durationMs: number;
  startedAt: number;
}

interface ReturnFlow {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  startedAt: number;
}

// ── Layout (viewBox 0–100) ───────────────────────────────────────

const CX = 50;
const CY = 50;
const TOOL_RING_R = 42;
const PERSONA_RING_R = 24;
const TOOL_NODE_R = 3.5;
const PERSONA_NODE_R = 4;
const CORE_OUTER_R = 13;
const CORE_INNER_R = 7;
const PROGRESS_R = PERSONA_NODE_R + 1.8;
const PROGRESS_CIRC = 2 * Math.PI * PROGRESS_R;

const RETURN_FLOW_MS = 1800;

// ── Default nodes ────────────────────────────────────────────────

const DEFAULT_TOOLS = [
  { id: 'def:gmail',     label: 'Gmail',     icon: null, color: '#ea4335' },
  { id: 'def:slack',     label: 'Slack',     icon: null, color: '#611f69' },
  { id: 'def:github',    label: 'GitHub',    icon: null, color: '#8b5cf6' },
  { id: 'def:calendar',  label: 'Calendar',  icon: null, color: '#06b6d4' },
  { id: 'def:jira',      label: 'Jira',      icon: null, color: '#0052cc' },
  { id: 'def:drive',     label: 'Drive',     icon: null, color: '#34a853' },
  { id: 'def:stripe',    label: 'Stripe',    icon: null, color: '#635bff' },
  { id: 'def:figma',     label: 'Figma',     icon: null, color: '#f24e1e' },
  { id: 'def:notion',    label: 'Notion',    icon: null, color: '#e0e0e0' },
  { id: 'def:discord',   label: 'Discord',   icon: null, color: '#5865F2' },
  { id: 'def:sentry',    label: 'Sentry',    icon: null, color: '#8456a6' },
  { id: 'def:vercel',    label: 'Vercel',    icon: null, color: '#c8c8c8' },
  { id: 'def:datadog',   label: 'Datadog',   icon: null, color: '#632CA6' },
  { id: 'def:aws',       label: 'AWS',       icon: null, color: '#FF9900' },
  { id: 'def:linear',    label: 'Linear',    icon: null, color: '#5E6AD2' },
  { id: 'def:hubspot',   label: 'HubSpot',   icon: null, color: '#FF7A59' },
];

const DEFAULT_PERSONAS = [
  { id: 'demo:inbox',    label: 'Inbox Triage',  icon: '📧', color: '#3b82f6' },
  { id: 'demo:reviewer', label: 'Code Review',   icon: '🔍', color: '#8b5cf6' },
  { id: 'demo:digest',   label: 'Slack Digest',  icon: '💬', color: '#06b6d4' },
  { id: 'demo:router',   label: 'Task Router',   icon: '🔀', color: '#f59e0b' },
  { id: 'demo:guard',    label: 'Deploy Guard',  icon: '🛡', color: '#10b981' },
  { id: 'demo:reporter', label: 'Report Gen',    icon: '📊', color: '#ec4899' },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  webhook_received: 'Webhook',
  execution_completed: 'Execution',
  persona_action: 'Action',
  credential_event: 'Credential',
  task_created: 'Task',
  test_event: 'Test',
  custom: 'Custom',
};

// ── Helpers ──────────────────────────────────────────────────────

function distributeOnRing(
  raw: { id: string; label: string; icon: string | null; color: string }[],
  radius: number,
  angleOffset = 0,
): SwarmNode[] {
  const count = raw.length;
  if (count === 0) return [];
  return raw.map((n, i) => {
    const angle = angleOffset + (i * 2 * Math.PI) / count;
    return { ...n, x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
  });
}

function iconChar(node: SwarmNode): string {
  if (node.icon && node.icon.length <= 2) return node.icon;
  return node.label[0]?.toUpperCase() ?? '?';
}

function clampLabel(label: string, max: number): string {
  return label.length > max ? label.slice(0, max - 1) + '\u2026' : label;
}

// ── Component ────────────────────────────────────────────────────

export default function EventBusVisualization({ events, personas, onSelectEvent }: Props) {
  const uid = useId();

  // ── Two rings ──────────────────────────────────────────────────
  const toolNodes = useMemo(() => distributeOnRing(DEFAULT_TOOLS, TOOL_RING_R), []);

  const personaNodes = useMemo(() => {
    const raw =
      personas.length > 0
        ? personas.slice(0, 12).map((p) => ({
            id: p.id,
            label: p.name,
            icon: p.icon,
            color: p.color ?? '#8b5cf6',
          }))
        : DEFAULT_PERSONAS;
    const offset = Math.PI / Math.max(raw.length, 1);
    return distributeOnRing(raw, PERSONA_RING_R, offset);
  }, [personas]);

  // ── Position maps ──────────────────────────────────────────────
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

  // ── Active events + seen types ─────────────────────────────────
  const { activeEvents, seenTypes, inFlightCount } = useMemo(() => {
    const active: RealtimeEvent[] = [];
    const types = new Set<string>();
    for (const e of events) {
      types.add(e.event_type);
      if (e._phase !== 'done') active.push(e);
    }
    return { activeEvents: active, seenTypes: [...types], inFlightCount: active.length };
  }, [events]);

  // ── Source / target helpers ────────────────────────────────────
  const getSourcePos = useCallback(
    (evt: RealtimeEvent) => {
      if (evt.source_id) {
        const p = toolPositionMap.get(evt.source_id) ?? toolPositionMap.get(`def:${evt.source_id}`);
        if (p) return p;
      }
      const h = (evt.id.charCodeAt(0) + (evt.id.charCodeAt(1) || 0)) * 137.5;
      const a = (h % 360) * (Math.PI / 180);
      return { x: CX + TOOL_RING_R * Math.cos(a), y: CY + TOOL_RING_R * Math.sin(a) };
    },
    [toolPositionMap],
  );

  const getTargetPos = useCallback(
    (evt: RealtimeEvent) => {
      if (evt.target_persona_id) {
        const pos = personaPositionMap.get(evt.target_persona_id);
        if (pos) return pos;
      }
      // Assign to a deterministic persona node
      const idx = evt.id.charCodeAt(0) % personaNodes.length;
      const pn = personaNodes[idx];
      return pn ? { x: pn.x, y: pn.y } : null;
    },
    [personaPositionMap, personaNodes],
  );

  // ── Processing state + return flows ────────────────────────────
  const [processingSet, setProcessingSet] = useState<Map<string, ProcessingInfo>>(new Map());
  const [returnFlows, setReturnFlows] = useState<ReturnFlow[]>([]);
  const spawnedRef = useRef(new Set<string>());
  const timeoutByAnimationIdRef = useRef(new Map<string, number>());

  const clearTrackedTimeouts = useCallback(() => {
    for (const timeoutId of timeoutByAnimationIdRef.current.values()) {
      clearTimeout(timeoutId);
    }
    timeoutByAnimationIdRef.current.clear();
  }, []);

  useEffect(() => () => {
    clearTrackedTimeouts();
  }, [clearTrackedTimeouts]);

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

      // Resolve persona ID for processing indicator
      const personaId = evt.target_persona_id
        ?? personaNodes[evt.id.charCodeAt(0) % personaNodes.length]?.id
        ?? 'unknown';

      const durationMs = 1200 + Math.random() * 1800; // 1.2–3s

      // Start circular progress on persona
      setProcessingSet((prev) => {
        const next = new Map(prev);
        next.set(personaId, { color, durationMs, startedAt: Date.now() });
        return next;
      });

      // After processing: remove indicator → spawn return particle
      const animationId = evt._animationId;
      const timeoutId = window.setTimeout(() => {
        timeoutByAnimationIdRef.current.delete(animationId);
        setProcessingSet((prev) => {
          const next = new Map(prev);
          next.delete(personaId);
          return next;
        });
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

  // Are there any active flows? (used to light up connections)
  const hasTraffic = activeEvents.length > 0 || returnFlows.length > 0 || processingSet.size > 0;

  return (
    <div className="w-full h-full relative min-h-[280px]">
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id={`${uid}-glow`}>
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`${uid}-pGlow`}>
            <feGaussianBlur stdDeviation="0.6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id={`${uid}-coreGrad`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={hasTraffic ? 'rgba(6,182,212,0.4)' : 'rgba(6,182,212,0.2)'} />
            <stop offset="40%" stopColor={hasTraffic ? 'rgba(168,85,247,0.2)' : 'rgba(168,85,247,0.08)'} />
            <stop offset="100%" stopColor="rgba(6,182,212,0)" />
          </radialGradient>
        </defs>

        {/* ═══ Central Core ═══ */}
        <circle cx={CX} cy={CY} r={CORE_OUTER_R} fill={`url(#${uid}-coreGrad)`} />
        <circle
          cx={CX} cy={CY} r={CORE_INNER_R}
          fill="rgba(255,255,255,0.03)"
          stroke={hasTraffic ? 'rgba(6,182,212,0.4)' : 'rgba(6,182,212,0.15)'}
          strokeWidth="0.4"
          className="transition-all duration-700"
        />
        {/* Slow idle pulse */}
        <circle cx={CX} cy={CY} r={CORE_INNER_R + 2} fill="none" stroke="rgba(6,182,212,0.08)" strokeWidth="0.15">
          <animate attributeName="r" values={`${CORE_INNER_R + 1};${CORE_INNER_R + 2.5};${CORE_INNER_R + 1}`} dur="5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.12;0.03;0.12" dur="5s" repeatCount="indefinite" />
        </circle>
        <text x={CX} y={CY + 0.6} textAnchor="middle" dominantBaseline="middle" fill={hasTraffic ? 'rgba(6,182,212,0.8)' : 'rgba(6,182,212,0.4)'} fontSize="2.4" fontFamily="monospace" letterSpacing="0.15em" className="transition-all duration-700">
          BUS
        </text>

        {/* ═══ Outer Ring — Tool Nodes (static, quiet) ═══ */}
        {toolNodes.map((node) => (
          <g key={node.id} opacity={0.65}>
            {/* Connection line */}
            <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke="rgba(255,255,255,0.03)" strokeWidth="0.15" strokeDasharray="0.8 1.5" />
            {/* Node */}
            <circle cx={node.x} cy={node.y} r={TOOL_NODE_R} fill={`${node.color}18`} stroke={node.color} strokeWidth="0.2" />
            <text x={node.x} y={node.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.7)" fontSize="2.4" fontFamily="monospace">
              {iconChar(node)}
            </text>
            <text x={node.x} y={node.y + TOOL_NODE_R + 2.2} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="1.5" fontFamily="monospace">
              {clampLabel(node.label, 9)}
            </text>
          </g>
        ))}

        {/* ═══ Middle Ring — Persona Nodes (static + breathing) ═══ */}
        {personaNodes.map((node, i) => {
          const proc = processingSet.get(node.id);
          return (
            <g key={node.id}>
              {/* Connection line */}
              <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={`${node.color}0a`} strokeWidth="0.2" strokeDasharray="1 2" />

              {/* Subtle idle breathing */}
              <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R + 0.5} fill="none" stroke={node.color} strokeWidth="0.1" opacity={0.1}>
                <animate attributeName="r" values={`${PERSONA_NODE_R + 0.3};${PERSONA_NODE_R + 1};${PERSONA_NODE_R + 0.3}`} dur={`${4 + (i % 2)}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.1;0.02;0.1" dur={`${4 + (i % 2)}s`} repeatCount="indefinite" />
              </circle>

              {/* Node body */}
              <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R} fill={`${node.color}15`} stroke={node.color} strokeWidth="0.3" opacity={0.9} />
              <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R * 0.5} fill={node.color} opacity={0.55} />

              {/* Icon */}
              <text x={node.x} y={node.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.85)" fontSize={node.icon && node.icon.length <= 2 ? '3' : '2.6'} fontFamily="monospace">
                {iconChar(node)}
              </text>
              {/* Label */}
              <text x={node.x} y={node.y + PERSONA_NODE_R + 2.4} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="1.5" fontFamily="monospace" fontWeight="500">
                {clampLabel(node.label, 10)}
              </text>

              {/* ── Circular progress arc (processing) ── */}
              {proc && (
                <g>
                  {/* Track ring (dim background) */}
                  <circle
                    cx={node.x} cy={node.y} r={PROGRESS_R}
                    fill="none" stroke={`${proc.color}20`} strokeWidth="0.5"
                  />
                  {/* Animated fill arc — dashoffset goes from full to 0 */}
                  <motion.circle
                    cx={node.x} cy={node.y} r={PROGRESS_R}
                    fill="none"
                    stroke={proc.color}
                    strokeWidth="0.5"
                    strokeLinecap="round"
                    style={{
                      strokeDasharray: PROGRESS_CIRC,
                      transformOrigin: `${node.x}px ${node.y}px`,
                      transform: `rotate(-90deg)`,
                    }}
                    initial={{ strokeDashoffset: PROGRESS_CIRC }}
                    animate={{ strokeDashoffset: 0 }}
                    transition={{ duration: proc.durationMs / 1000, ease: 'linear' }}
                  />
                  {/* Glow halo while processing */}
                  <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R + 0.5} fill="none" stroke={proc.color} strokeWidth="0.15" opacity={0.35}>
                    <animate attributeName="opacity" values="0.35;0.1;0.35" dur="0.7s" repeatCount="indefinite" />
                  </circle>
                </g>
              )}
            </g>
          );
        })}

        {/* ═══ Inbound Particles (tool → center → persona) ═══ */}
        {activeEvents.map((evt) => {
          const src = getSourcePos(evt);
          const tgt = getTargetPos(evt);
          const color = EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8';
          const pColor = evt.status === 'failed' ? '#ef4444' : color;
          const isDone = evt._phase === 'done';

          let tx: number, ty: number;
          switch (evt._phase) {
            case 'entering': case 'on-bus':
              tx = CX; ty = CY; break;
            case 'delivering': default:
              tx = tgt?.x ?? CX; ty = tgt?.y ?? CY;
          }

          return (
            <g key={evt._animationId} onClick={() => onSelectEvent(evt)} style={{ cursor: 'pointer' }}>
              <motion.circle
                initial={{ cx: src.x, cy: src.y }}
                animate={{ cx: tx, cy: ty, opacity: isDone ? 0 : 0.2 }}
                transition={{ duration: 0.7, ease: 'easeInOut' }}
                r={1.8} fill={pColor}
              />
              <motion.circle
                initial={{ cx: src.x, cy: src.y }}
                animate={{ cx: tx, cy: ty, opacity: isDone ? 0 : 1 }}
                transition={{ duration: 0.6, ease: 'easeInOut' }}
                r={1} fill={pColor} filter={`url(#${uid}-glow)`}
              />
              <motion.circle
                initial={{ cx: src.x, cy: src.y }}
                animate={{ cx: tx, cy: ty, opacity: isDone ? 0 : 0.9 }}
                transition={{ duration: 0.6, ease: 'easeInOut' }}
                r={0.35} fill="white"
              />
              {evt._phase === 'delivering' && (evt.status === 'completed' || evt.status === 'failed') && (
                <motion.circle
                  initial={{ r: 1, opacity: 0.5 }}
                  animate={{ r: 4, opacity: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  cx={tx} cy={ty} fill="none" stroke={pColor} strokeWidth={0.25}
                />
              )}
            </g>
          );
        })}

        {/* ═══ Return-Flow Particles (persona → center → tool) ═══ */}
        <AnimatePresence>
          {returnFlows.map((flow) => (
            <motion.g key={flow.id} initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.circle
                r={1.4} fill={flow.color} opacity={0.15}
                initial={{ cx: flow.fromX, cy: flow.fromY }}
                animate={{ cx: [flow.fromX, CX, flow.toX], cy: [flow.fromY, CY, flow.toY] }}
                transition={{ duration: RETURN_FLOW_MS / 1000, times: [0, 0.4, 1], ease: 'easeInOut' }}
              />
              <motion.circle
                r={0.8} fill={flow.color} filter={`url(#${uid}-glow)`}
                initial={{ cx: flow.fromX, cy: flow.fromY, opacity: 0.9 }}
                animate={{ cx: [flow.fromX, CX, flow.toX], cy: [flow.fromY, CY, flow.toY], opacity: [0.9, 1, 0.7] }}
                transition={{ duration: RETURN_FLOW_MS / 1000, times: [0, 0.4, 1], ease: 'easeInOut' }}
              />
              <motion.circle
                r={0.3} fill="white"
                initial={{ cx: flow.fromX, cy: flow.fromY }}
                animate={{ cx: [flow.fromX, CX, flow.toX], cy: [flow.fromY, CY, flow.toY] }}
                transition={{ duration: RETURN_FLOW_MS / 1000, times: [0, 0.4, 1], ease: 'easeInOut' }}
              />
              <motion.circle
                cx={flow.toX} cy={flow.toY}
                fill="none" stroke={flow.color} strokeWidth={0.2}
                initial={{ r: 0.8, opacity: 0 }}
                animate={{ r: 3.5, opacity: [0, 0.4, 0] }}
                transition={{ duration: 0.5, delay: (RETURN_FLOW_MS / 1000) * 0.85, ease: 'easeOut' }}
              />
            </motion.g>
          ))}
        </AnimatePresence>

        {/* ═══ Badges ═══ */}
        {/* In-flight events (right) */}
        <rect x={72} y={91} width={24} height={5} rx={2.5} fill="rgba(6,182,212,0.08)" stroke="rgba(6,182,212,0.15)" strokeWidth="0.3" />
        <text x={84} y={93.8} textAnchor="middle" dominantBaseline="middle" fill={inFlightCount > 0 ? 'rgba(6,182,212,0.9)' : 'rgba(6,182,212,0.4)'} fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">
          {inFlightCount} in-flight
        </text>

        {/* Agent count (left) */}
        <rect x={4} y={91} width={24} height={5} rx={2.5} fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.15)" strokeWidth="0.3" />
        <text x={16} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(168,85,247,0.6)" fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">
          {personaNodes.length} agents
        </text>
      </svg>

      {/* ── Legend (only when traffic flowing) ── */}
      {seenTypes.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm border border-primary/10 rounded-lg px-3 py-2 flex items-center gap-3">
          <AnimatePresence initial={false}>
            {seenTypes.slice(0, 6).map((type) => (
              <motion.div
                key={type}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1.5"
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: EVENT_TYPE_HEX_COLORS[type] ?? '#818cf8' }} />
                <span className="text-[10px] font-mono text-muted-foreground/80">{EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Idle empty state ── */}
      {events.length === 0 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-background/60 backdrop-blur-sm border border-primary/10 rounded-lg px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan/40" />
            <span className="text-[11px] text-muted-foreground/60">
              Idle — click <span className="font-medium text-purple-300/80">Test Flow</span> to simulate traffic
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

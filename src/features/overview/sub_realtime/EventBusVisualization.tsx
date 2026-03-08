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
  droppedCount?: number;
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

interface SwarmNode {
  id: string;
  label: string;
  icon: string | null;
  color: string;
  x: number;
  y: number;
  /** Relative size factor 0-1 based on event volume. */
  sizeFactor?: number;
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

/** Tracked source discovered from real event traffic. */
export interface DiscoveredSource {
  id: string;
  label: string;
  count: number;
  lastSeen: number;
}

// ── Layout (viewBox 0–100) ───────────────────────────────────────

const CX = 50;
const CY = 50;
const TOOL_RING_R = 42;
const PERSONA_RING_R = 24;
const TOOL_NODE_R_MIN = 2.5;
const TOOL_NODE_R_MAX = 4.5;
const TOOL_NODE_R = 3.5;
const PERSONA_NODE_R = 4;
const CORE_OUTER_R = 13;
const CORE_INNER_R = 7;
const PROGRESS_R = PERSONA_NODE_R + 1.8;
const PROGRESS_CIRC = 2 * Math.PI * PROGRESS_R;

const RETURN_FLOW_MS = 1800;

/** Sources fade to ghost opacity after this many ms without traffic. */
const FADE_AFTER_MS = 30_000;

// ── Known source colors ──────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  gmail: '#ea4335', slack: '#611f69', github: '#8b5cf6', calendar: '#06b6d4',
  jira: '#0052cc', drive: '#34a853', stripe: '#635bff', figma: '#f24e1e',
  notion: '#e0e0e0', discord: '#5865F2', sentry: '#8456a6', vercel: '#c8c8c8',
  datadog: '#632CA6', aws: '#FF9900', linear: '#5E6AD2', hubspot: '#FF7A59',
  webhook: '#06b6d4', system: '#8b5cf6', trigger: '#f59e0b', test: '#10b981',
  cloud: '#38bdf8', gitlab: '#FC6D26', deployment: '#38bdf8',
};

function colorForSource(id: string): string {
  const lower = id.toLowerCase();
  for (const [key, color] of Object.entries(SOURCE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  // Deterministic hash color for unknown sources
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function labelForSource(id: string): string {
  // Capitalize first letter, replace underscores/hyphens
  const cleaned = id.replace(/[_-]/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// ── Default nodes (fallback when no real traffic yet) ────────────

const DEFAULT_TOOLS: Array<{ id: string; label: string; icon: null; color: string }> = [
  { id: 'def:gmail',     label: 'Gmail',     icon: null, color: '#ea4335' },
  { id: 'def:slack',     label: 'Slack',     icon: null, color: '#611f69' },
  { id: 'def:github',    label: 'GitHub',    icon: null, color: '#8b5cf6' },
  { id: 'def:calendar',  label: 'Calendar',  icon: null, color: '#06b6d4' },
  { id: 'def:jira',      label: 'Jira',      icon: null, color: '#0052cc' },
  { id: 'def:drive',     label: 'Drive',     icon: null, color: '#34a853' },
  { id: 'def:stripe',    label: 'Stripe',    icon: null, color: '#635bff' },
  { id: 'def:notion',    label: 'Notion',    icon: null, color: '#e0e0e0' },
  { id: 'def:cloud',     label: 'Cloud',     icon: null, color: '#38bdf8' },
  { id: 'def:gitlab',    label: 'GitLab',    icon: null, color: '#FC6D26' },
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
  deploy_started: 'Deploy',
  deploy_succeeded: 'Deployed',
  deploy_failed: 'Deploy Fail',
  deploy_paused: 'Paused',
  deploy_resumed: 'Resumed',
  agent_undeployed: 'Undeployed',
  credential_provisioned: 'Cred Prov.',
};

// ── Helpers ──────────────────────────────────────────────────────

function distributeOnRing(
  raw: { id: string; label: string; icon: string | null; color: string; sizeFactor?: number }[],
  radius: number,
  angleOffset = 0,
): SwarmNode[] {
  const count = raw.length;
  if (count === 0) return [];
  return raw.map((n, i) => {
    const angle = angleOffset + (i * 2 * Math.PI) / count;
    return { ...n, x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle), sizeFactor: n.sizeFactor };
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

export default function EventBusVisualization({ events, personas, droppedCount = 0, onSelectEvent }: Props) {
  const uid = useId();

  // ── Discovered source topology ─────────────────────────────────
  const discoveredSourcesRef = useRef(new Map<string, DiscoveredSource>());

  // Track sources from incoming events
  useEffect(() => {
    const map = discoveredSourcesRef.current;
    for (const evt of events) {
      const key = evt.source_id || evt.source_type || 'unknown';
      if (!key || key === 'unknown') continue;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        existing.lastSeen = Date.now();
      } else {
        map.set(key, {
          id: key,
          label: labelForSource(key),
          count: 1,
          lastSeen: Date.now(),
        });
      }
    }
  }, [events]);

  // Build tool ring from discovered sources (or fallback to defaults)
  const toolNodes = useMemo(() => {
    const discovered = discoveredSourcesRef.current;
    if (discovered.size === 0) {
      return distributeOnRing(DEFAULT_TOOLS, TOOL_RING_R);
    }

    const now = Date.now();
    const sources = Array.from(discovered.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 16); // Cap at 16 nodes

    const maxCount = Math.max(1, ...sources.map(s => s.count));

    const raw = sources.map(s => {
      const age = now - s.lastSeen;
      const sizeFactor = 0.3 + 0.7 * (s.count / maxCount);
      return {
        id: s.id,
        label: s.label,
        icon: null,
        color: colorForSource(s.id),
        sizeFactor: age > FADE_AFTER_MS ? sizeFactor * 0.5 : sizeFactor,
      };
    });

    return distributeOnRing(raw, TOOL_RING_R);
    // Re-derive when event count changes (batch updates)
  }, [events.length]);

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
      const sourceKey = evt.source_id || evt.source_type;
      if (sourceKey) {
        const p = toolPositionMap.get(sourceKey) ?? toolPositionMap.get(`def:${sourceKey}`);
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

        {/* ═══ Outer Ring — Tool/Source Nodes (dynamic topology) ═══ */}
        {toolNodes.map((node) => {
          const sf = node.sizeFactor ?? 1;
          const isDiscovered = !node.id.startsWith('def:');
          const nodeR = isDiscovered
            ? TOOL_NODE_R_MIN + sf * (TOOL_NODE_R_MAX - TOOL_NODE_R_MIN)
            : TOOL_NODE_R;
          const nodeOpacity = isDiscovered ? 0.4 + sf * 0.5 : 0.45;
          const lineWidth = isDiscovered ? 0.1 + sf * 0.25 : 0.15;
          return (
            <g key={node.id} opacity={nodeOpacity}>
              {/* Connection line — thickness proportional to volume */}
              <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={isDiscovered ? `${node.color}15` : 'rgba(255,255,255,0.03)'} strokeWidth={lineWidth} strokeDasharray="0.8 1.5" />
              {/* Node */}
              <circle cx={node.x} cy={node.y} r={nodeR} fill={`${node.color}18`} stroke={node.color} strokeWidth={isDiscovered ? 0.3 : 0.2} />
              <text x={node.x} y={node.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.7)" fontSize={isDiscovered ? Math.max(1.8, 2.4 * sf) : 2.4} fontFamily="monospace">
                {iconChar(node)}
              </text>
              <text x={node.x} y={node.y + nodeR + 2.2} textAnchor="middle" fill={isDiscovered ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)'} fontSize="1.5" fontFamily="monospace">
                {clampLabel(node.label, 9)}
              </text>
            </g>
          );
        })}

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

        {/* Source count (center) */}
        {discoveredSourcesRef.current.size > 0 && (
          <>
            <rect x={38} y={91} width={24} height={5} rx={2.5} fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.15)" strokeWidth="0.3" />
            <text x={50} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(245,158,11,0.6)" fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">
              {discoveredSourcesRef.current.size} sources
            </text>
          </>
        )}

        {/* Agent count (left) */}
        <rect x={4} y={91} width={24} height={5} rx={2.5} fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.15)" strokeWidth="0.3" />
        <text x={16} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(168,85,247,0.6)" fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">
          {personaNodes.length} agents
        </text>
      </svg>

      {/* ── Legend (only when traffic flowing) ── */}
      {seenTypes.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm border border-primary/10 rounded-xl px-3 py-2 flex items-center gap-3">
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
                <span className="text-sm font-mono text-muted-foreground/80">{EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Dropped events indicator ── */}
      {droppedCount > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 flex-shrink-0" />
            <span className="text-xs font-mono text-amber-300/80">
              {droppedCount.toLocaleString()} earlier event{droppedCount !== 1 ? 's' : ''} not shown
            </span>
          </div>
        </div>
      )}

      {/* ── Idle empty state ── */}
      {events.length === 0 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-background/60 backdrop-blur-sm border border-primary/10 rounded-xl px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan/40" />
            <span className="text-sm text-muted-foreground/60">
              Idle — click <span className="font-medium text-purple-300/80">Test Flow</span> to simulate traffic
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

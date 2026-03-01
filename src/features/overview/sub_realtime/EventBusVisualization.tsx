import { useMemo, useRef, useEffect, useState, useCallback, useId, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import BusLane from './BusLane';
import EventParticle from './EventParticle';
import {
  Mail, MessageSquare, Github, Calendar, CreditCard,
  HardDrive, SquareKanban, Figma,
} from 'lucide-react';

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

interface NodePosition {
  id: string;
  label: string;
  icon: string | null;
  color: string | null;
  x: number;
  y: number;
  side: 'top' | 'bottom';
}

const PADDING_X = 40;
const PADDING_Y = 36;
const NODE_RADIUS = 22;
const BUS_HEIGHT = 6;
const MAX_LEGEND_ITEMS = 6;

const EVENT_TYPE_LABELS: Record<string, string> = {
  webhook_received: 'Webhook',
  execution_completed: 'Execution',
  persona_action: 'Persona Action',
  credential_event: 'Credential',
  task_created: 'Task Created',
  test_event: 'Test Event',
  custom: 'Custom',
};

/** Default producer nodes shown when there are no real events (or for test flow). */
const DEFAULT_PRODUCERS = [
  { id: 'default:gmail', label: 'Gmail', icon: 'mail', color: '#ea4335' },
  { id: 'default:slack', label: 'Slack', icon: 'slack', color: '#4a154b' },
  { id: 'default:github', label: 'GitHub', icon: 'github', color: '#8b5cf6' },
  { id: 'default:calendar', label: 'Calendar', icon: 'calendar', color: '#06b6d4' },
];

const DEFAULT_CONSUMERS = [
  { id: 'default:jira', label: 'Jira', icon: 'jira', color: '#0052cc' },
  { id: 'default:drive', label: 'Drive', icon: 'drive', color: '#34a853' },
  { id: 'default:stripe', label: 'Stripe', icon: 'stripe', color: '#635bff' },
  { id: 'default:figma', label: 'Figma', icon: 'figma', color: '#f24e1e' },
];

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  mail: Mail,
  slack: MessageSquare,
  github: Github,
  calendar: Calendar,
  jira: SquareKanban,
  drive: HardDrive,
  stripe: CreditCard,
  figma: Figma,
};

const NodeIcon = memo(function NodeIcon({ node }: { node: NodePosition }) {
  const IconComp = node.icon ? ICON_MAP[node.icon] : null;
  if (IconComp) {
    return (
      <foreignObject x={node.x - 8} y={node.y - 8} width={16} height={16}>
        <IconComp className="w-4 h-4 text-white/80" />
      </foreignObject>
    );
  }
  return (
    <text
      x={node.x}
      y={node.y}
      textAnchor="middle"
      dominantBaseline="central"
      fill="white"
      fontSize={12}
      fontWeight="bold"
      opacity={0.8}
    >
      {node.icon && node.icon.length <= 2 ? node.icon : (node.label[0]?.toUpperCase() ?? '?')}
    </text>
  );
});

export default function EventBusVisualization({ events, personas, onSelectEvent }: Props) {
  const uid = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  // Responsive sizing — debounced via rAF to prevent resize thrashing
  const dimensionsRef = useRef(dimensions);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const w = Math.floor(width);
          const h = Math.floor(height);
          if (w !== dimensionsRef.current.width || h !== dimensionsRef.current.height) {
            dimensionsRef.current = { width: w, height: h };
            setDimensions({ width: w, height: h });
          }
        }
      });
    });
    observer.observe(containerRef.current);
    return () => { cancelAnimationFrame(rafRef.current); observer.disconnect(); };
  }, []);

  const { width, height } = dimensions;
  const busY = height / 2;

  // Build persona lookup
  const personaMap = useMemo(() => {
    const m = new Map<string, PersonaInfo>();
    for (const p of personas) m.set(p.id, p);
    return m;
  }, [personas]);

  // Compute producer and consumer nodes from events, falling back to defaults
  const { producers, consumers } = useMemo(() => {
    const sourceSet = new Map<string, { type: string; id: string | null }>();
    const targetSet = new Set<string>();

    for (const evt of events) {
      const key = `${evt.source_type}:${evt.source_id ?? 'unknown'}`;
      if (!sourceSet.has(key)) {
        sourceSet.set(key, { type: evt.source_type, id: evt.source_id });
      }
      if (evt.target_persona_id) {
        targetSet.add(evt.target_persona_id);
      }
    }

    let producerArr: NodePosition[];
    let consumerArr: NodePosition[];

    if (sourceSet.size === 0) {
      // Show default showcase nodes when no real events
      producerArr = DEFAULT_PRODUCERS.map((d, i) => ({
        id: d.id,
        label: d.label,
        icon: d.icon,
        color: d.color,
        x: PADDING_X + ((width - 2 * PADDING_X) / (DEFAULT_PRODUCERS.length + 1)) * (i + 1),
        y: PADDING_Y + NODE_RADIUS,
        side: 'top' as const,
      }));
      consumerArr = DEFAULT_CONSUMERS.map((d, i) => ({
        id: d.id,
        label: d.label,
        icon: d.icon,
        color: d.color,
        x: PADDING_X + ((width - 2 * PADDING_X) / (DEFAULT_CONSUMERS.length + 1)) * (i + 1),
        y: height - PADDING_Y - NODE_RADIUS,
        side: 'bottom' as const,
      }));
    } else {
      producerArr = [];
      const sourceEntries = Array.from(sourceSet.entries()).slice(0, 8);
      const pCount = Math.max(sourceEntries.length, 1);
      sourceEntries.forEach(([key, val], i) => {
        const persona = val.id ? personaMap.get(val.id) : null;
        const sourceLabels: Record<string, string> = {
          webhook: 'Webhook', execution: 'Execution', persona: 'Persona',
          trigger: 'Trigger', system: 'System',
        };
        producerArr.push({
          id: key,
          label: persona?.name ?? sourceLabels[val.type] ?? val.type,
          icon: persona?.icon ?? null,
          color: persona?.color ?? null,
          x: PADDING_X + ((width - 2 * PADDING_X) / (pCount + 1)) * (i + 1),
          y: PADDING_Y + NODE_RADIUS,
          side: 'top',
        });
      });

      consumerArr = [];
      const targetEntries = Array.from(targetSet).slice(0, 8);
      const cCount = Math.max(targetEntries.length, 1);
      targetEntries.forEach((pid, i) => {
        const persona = personaMap.get(pid);
        consumerArr.push({
          id: pid,
          label: persona?.name ?? pid.slice(0, 8),
          icon: persona?.icon ?? null,
          color: persona?.color ?? null,
          x: PADDING_X + ((width - 2 * PADDING_X) / (cCount + 1)) * (i + 1),
          y: height - PADDING_Y - NODE_RADIUS,
          side: 'bottom',
        });
      });
    }

    return { producers: producerArr, consumers: consumerArr };
  }, [events, personaMap, width, height]);

  // Build position lookup for particles
  const nodePositions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of producers) m.set(p.id, { x: p.x, y: p.y });
    for (const c of consumers) m.set(c.id, { x: c.x, y: c.y });
    return m;
  }, [producers, consumers]);

  // Get source position for an event
  const getSourcePos = useCallback((evt: RealtimeEvent) => {
    const key = `${evt.source_type}:${evt.source_id ?? 'unknown'}`;
    return nodePositions.get(key) ?? { x: width / 2, y: PADDING_Y + NODE_RADIUS };
  }, [nodePositions, width]);

  // Get target position for an event
  const getTargetPos = useCallback((evt: RealtimeEvent) => {
    if (!evt.target_persona_id) return null;
    return nodePositions.get(evt.target_persona_id) ?? null;
  }, [nodePositions]);

  // Derive active events, active node IDs, and seen types in a single pass
  const { activeEvents, activeNodeIds, seenTypes } = useMemo(() => {
    const active: RealtimeEvent[] = [];
    const nodeIds = new Set<string>();
    const types = new Set<string>();
    for (const e of events) {
      types.add(e.event_type);
      if (e._phase !== 'done') {
        active.push(e);
        nodeIds.add(`${e.source_type}:${e.source_id ?? 'unknown'}`);
        if (e.target_persona_id) nodeIds.add(e.target_persona_id);
      }
    }
    return { activeEvents: active, activeNodeIds: nodeIds, seenTypes: [...types] };
  }, [events]);

  // Ambient animated dots flowing across the bus (web-style visual)
  const ambientDots = useMemo(() => {
    const colors = ['#ea4335', '#4a154b', '#8b5cf6', '#06b6d4', '#0052cc', '#34a853', '#635bff', '#f24e1e'];
    return Array.from({ length: 6 }, (_, i) => ({
      color: colors[i % colors.length]!,
      delay: i * 0.8,
      duration: 2.5 + (i % 3) * 0.4,
    }));
  }, []);

  // (renderNodeIcon extracted to NodeIcon component below)

  return (
    <div ref={containerRef} className="w-full h-full relative min-h-[280px]">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
      >
        {/* Gradient definitions */}
        <defs>
          <linearGradient id={`${uid}-busGrad`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(6, 182, 212, 0)" />
            <stop offset="15%" stopColor="rgba(6, 182, 212, 0.12)" />
            <stop offset="50%" stopColor="rgba(168, 85, 247, 0.10)" />
            <stop offset="85%" stopColor="rgba(6, 182, 212, 0.12)" />
            <stop offset="100%" stopColor="rgba(6, 182, 212, 0)" />
          </linearGradient>
          <linearGradient id="busGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(139, 92, 246, 0)" />
            <stop offset="15%" stopColor="rgba(139, 92, 246, 0.5)" />
            <stop offset="50%" stopColor="rgba(139, 92, 246, 0.7)" />
            <stop offset="85%" stopColor="rgba(139, 92, 246, 0.5)" />
            <stop offset="100%" stopColor="rgba(139, 92, 246, 0)" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="particleGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id={`${uid}-busClip`}>
            <rect
              x={PADDING_X}
              y={busY - BUS_HEIGHT * 2}
              width={width - 2 * PADDING_X}
              height={BUS_HEIGHT * 4}
              rx={BUS_HEIGHT}
            />
          </clipPath>
        </defs>

        {/* Connection lines from producer nodes to bus — with arrow tips */}
        {producers.map(node => {
          const isActive = activeNodeIds.has(node.id);
          const nodeColor = node.color ?? '#8b5cf6';
          return (
            <g key={`conn-prod-${node.id}`}>
              <line
                x1={node.x}
                y1={node.y + NODE_RADIUS}
                x2={node.x}
                y2={busY - BUS_HEIGHT * 2}
                stroke={isActive ? `${nodeColor}50` : 'rgba(255,255,255,0.06)'}
                strokeWidth={isActive ? 1.5 : 0.8}
                strokeDasharray="4 4"
                className="transition-all duration-500"
              />
              <polygon
                points={`${node.x - 4},${busY - BUS_HEIGHT * 2 - 4} ${node.x},${busY - BUS_HEIGHT * 2} ${node.x + 4},${busY - BUS_HEIGHT * 2 - 4}`}
                fill={isActive ? `${nodeColor}40` : 'rgba(255,255,255,0.08)'}
              />
              {/* Animated dot flowing from producer to bus */}
              {isActive && (
                <motion.circle
                  r={2.5}
                  fill={nodeColor}
                  cx={node.x}
                  filter="url(#particleGlow)"
                  initial={{ cy: node.y + NODE_RADIUS, opacity: 0 }}
                  animate={{ cy: [node.y + NODE_RADIUS, busY - BUS_HEIGHT * 2], opacity: [0, 0.9, 0.9, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 2.5, ease: 'linear' }}
                />
              )}
            </g>
          );
        })}

        {/* Connection lines from bus to consumer nodes */}
        {consumers.map(node => {
          const isActive = activeNodeIds.has(node.id);
          const nodeColor = node.color ?? '#8b5cf6';
          return (
            <g key={`conn-cons-${node.id}`}>
              <line
                x1={node.x}
                y1={busY + BUS_HEIGHT * 2}
                x2={node.x}
                y2={node.y - NODE_RADIUS}
                stroke={isActive ? `${nodeColor}50` : 'rgba(255,255,255,0.06)'}
                strokeWidth={isActive ? 1.5 : 0.8}
                strokeDasharray="4 4"
                className="transition-all duration-500"
              />
              <polygon
                points={`${node.x - 4},${node.y - NODE_RADIUS + 4} ${node.x},${node.y - NODE_RADIUS} ${node.x + 4},${node.y - NODE_RADIUS + 4}`}
                fill={isActive ? `${nodeColor}40` : 'rgba(255,255,255,0.08)'}
              />
              {/* Animated dot flowing from bus to consumer */}
              {isActive && (
                <motion.circle
                  r={2.5}
                  fill={nodeColor}
                  cx={node.x}
                  filter="url(#particleGlow)"
                  initial={{ cy: busY + BUS_HEIGHT * 2, opacity: 0 }}
                  animate={{ cy: [busY + BUS_HEIGHT * 2, node.y - NODE_RADIUS], opacity: [0, 0.9, 0.9, 0] }}
                  transition={{ duration: 1.8, delay: 0.3, repeat: Infinity, repeatDelay: 2.5, ease: 'linear' }}
                />
              )}
            </g>
          );
        })}

        {/* Bus lane */}
        <BusLane
          x={PADDING_X}
          y={busY}
          width={width - 2 * PADDING_X}
          height={BUS_HEIGHT}
          isActive={activeEvents.length > 0}
        />

        {/* Ambient flowing dots across the bus (web-style visual) */}
        <g clipPath={`url(#${uid}-busClip)`}>
          {ambientDots.map((dot, i) => (
            <motion.circle
              key={`ambient-${i}`}
              r={2}
              cy={busY}
              fill={dot.color}
              opacity={0.6}
              filter="url(#particleGlow)"
              initial={{ cx: PADDING_X - 10 }}
              animate={{ cx: [PADDING_X - 10, width - PADDING_X + 10] }}
              transition={{
                duration: dot.duration,
                delay: dot.delay,
                repeat: Infinity,
                repeatDelay: 1.5,
                ease: 'linear',
              }}
            />
          ))}
        </g>

        {/* Direction arrow on bus */}
        <polygon
          points={`${width - PADDING_X - 6},${busY - 4} ${width - PADDING_X},${busY} ${width - PADDING_X - 6},${busY + 4}`}
          fill="rgba(6, 182, 212, 0.25)"
        />

        {/* Producer nodes — concentric circles (web style) */}
        {producers.map(node => {
          const isActive = activeNodeIds.has(node.id);
          const nodeColor = node.color ?? '#6366f1';
          return (
            <g key={`node-prod-${node.id}`}>
              {/* Outer glow ring */}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_RADIUS}
                fill={`${nodeColor}08`}
                stroke={nodeColor}
                strokeWidth={isActive ? 1.5 : 0.6}
                opacity={isActive ? 0.9 : 0.5}
                className="transition-all duration-500"
              />
              {/* Active glow halo */}
              {isActive && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={NODE_RADIUS + 4}
                  fill="none"
                  stroke={nodeColor}
                  strokeWidth={0.5}
                  opacity={0.2}
                >
                  <animate
                    attributeName="opacity"
                    values="0.1;0.3;0.1"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              {/* Inner filled circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_RADIUS * 0.45}
                fill={nodeColor}
                opacity={0.85}
              />
              {/* Icon */}
              <NodeIcon node={node} />
            </g>
          );
        })}

        {/* Consumer nodes — concentric circles (web style) */}
        {consumers.map(node => {
          const isActive = activeNodeIds.has(node.id);
          const nodeColor = node.color ?? '#6366f1';
          return (
            <g key={`node-cons-${node.id}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_RADIUS}
                fill={`${nodeColor}08`}
                stroke={nodeColor}
                strokeWidth={isActive ? 1.5 : 0.6}
                opacity={isActive ? 0.9 : 0.5}
                className="transition-all duration-500"
              />
              {isActive && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={NODE_RADIUS + 4}
                  fill="none"
                  stroke={nodeColor}
                  strokeWidth={0.5}
                  opacity={0.2}
                >
                  <animate
                    attributeName="opacity"
                    values="0.1;0.3;0.1"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_RADIUS * 0.45}
                fill={nodeColor}
                opacity={0.85}
              />
              <NodeIcon node={node} />
            </g>
          );
        })}

        {/* Event particles */}
        {activeEvents.map(evt => (
          <EventParticle
            key={evt._animationId}
            event={evt}
            sourcePos={getSourcePos(evt)}
            busY={busY}
            targetPos={getTargetPos(evt)}
            color={EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8'}
            onClick={() => onSelectEvent(evt)}
          />
        ))}
      </svg>

      {/* Producer labels as HTML overlays */}
      {producers.map(node => (
        <div
          key={`label-prod-${node.id}`}
          className="absolute flex flex-col items-center pointer-events-none"
          style={{
            left: node.x - 40,
            top: node.y - NODE_RADIUS - 6,
            width: 80,
            transform: 'translateY(-100%)',
          }}
        >
          <span className="text-[11px] font-medium text-foreground/80 truncate max-w-[80px] text-center" title={node.label}>
            {node.label}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40 mt-0.5">
            producer
          </span>
        </div>
      ))}

      {/* Consumer labels as HTML overlays */}
      {consumers.map(node => (
        <div
          key={`label-cons-${node.id}`}
          className="absolute flex flex-col items-center pointer-events-none"
          style={{
            left: node.x - 40,
            top: node.y + NODE_RADIUS + 6,
            width: 80,
          }}
        >
          <span className="text-[11px] font-medium text-foreground/80 truncate max-w-[80px] text-center" title={node.label}>
            {node.label}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40 mt-0.5">
            consumer
          </span>
        </div>
      ))}

      {/* Event type color legend */}
      {seenTypes.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 bg-background/80 backdrop-blur-sm border border-primary/10 rounded-lg px-3 py-2">
          <AnimatePresence initial={false}>
            {seenTypes.slice(0, MAX_LEGEND_ITEMS).map((type) => (
              <motion.div
                key={type}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2 py-0.5"
              >
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: EVENT_TYPE_HEX_COLORS[type] ?? '#818cf8' }}
                />
                <span className="text-sm font-mono text-muted-foreground/80">
                  {EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {seenTypes.length > MAX_LEGEND_ITEMS && (
            <div className="text-sm font-mono text-muted-foreground/80 pt-0.5">
              +{seenTypes.length - MAX_LEGEND_ITEMS} more
            </div>
          )}
        </div>
      )}

      {/* Empty state overlay — centered message under the visualization */}
      {events.length === 0 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-background/60 backdrop-blur-sm border border-primary/10 rounded-lg px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-sm text-muted-foreground/80">
              Waiting for events — click <span className="font-medium text-purple-300">Test Flow</span> to simulate traffic
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

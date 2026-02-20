import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import BusLane from './BusLane';
import EventParticle from './EventParticle';

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

const PADDING_X = 60;
const PADDING_Y = 40;
const NODE_RADIUS = 20;
const BUS_HEIGHT = 4;
const MAX_LEGEND_ITEMS = 6;

const EVENT_TYPE_LABELS: Record<string, string> = {
  webhook_received: 'Webhook',
  execution_completed: 'Execution',
  persona_action: 'Persona Action',
  credential_event: 'Credential',
  task_created: 'Task Created',
  custom: 'Custom',
};

export default function EventBusVisualization({ events, personas, onSelectEvent }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const busY = height / 2;

  // Build persona lookup
  const personaMap = useMemo(() => {
    const m = new Map<string, PersonaInfo>();
    for (const p of personas) m.set(p.id, p);
    return m;
  }, [personas]);

  // Compute producer and consumer nodes from events
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

    const producerArr: NodePosition[] = [];
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

    const consumerArr: NodePosition[] = [];
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

  // Active events (not done)
  const activeEvents = useMemo(
    () => events.filter(e => e._phase !== 'done'),
    [events]
  );

  // Active node IDs
  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of activeEvents) {
      ids.add(`${e.source_type}:${e.source_id ?? 'unknown'}`);
      if (e.target_persona_id) ids.add(e.target_persona_id);
    }
    return ids;
  }, [activeEvents]);

  // Track seen event types across the session (accumulate, never remove)
  const [seenTypes, setSeenTypes] = useState<string[]>([]);
  useEffect(() => {
    setSeenTypes((prev) => {
      const existing = new Set(prev);
      const added: string[] = [];
      for (const evt of events) {
        if (!existing.has(evt.event_type)) {
          existing.add(evt.event_type);
          added.push(evt.event_type);
        }
      }
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [events]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
      >
        {/* Gradient definitions */}
        <defs>
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
        </defs>

        {/* Connection lines from producer nodes to bus */}
        {producers.map(node => (
          <line
            key={`conn-prod-${node.id}`}
            x1={node.x}
            y1={node.y + NODE_RADIUS}
            x2={node.x}
            y2={busY - BUS_HEIGHT / 2}
            stroke={activeNodeIds.has(node.id) ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.08)'}
            strokeWidth={1}
            strokeDasharray="4 4"
            className="transition-all duration-500"
          />
        ))}

        {/* Connection lines from bus to consumer nodes */}
        {consumers.map(node => (
          <line
            key={`conn-cons-${node.id}`}
            x1={node.x}
            y1={busY + BUS_HEIGHT / 2}
            x2={node.x}
            y2={node.y - NODE_RADIUS}
            stroke={activeNodeIds.has(node.id) ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.08)'}
            strokeWidth={1}
            strokeDasharray="4 4"
            className="transition-all duration-500"
          />
        ))}

        {/* Bus lane */}
        <BusLane
          x={PADDING_X}
          y={busY}
          width={width - 2 * PADDING_X}
          height={BUS_HEIGHT}
          isActive={activeEvents.length > 0}
        />

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

      {/* Producer node labels rendered as HTML overlays for better text rendering */}
      {producers.map(node => (
        <div
          key={`label-prod-${node.id}`}
          className="absolute flex flex-col items-center"
          style={{
            left: node.x - 40,
            top: node.y - NODE_RADIUS - 4,
            width: 80,
            transform: 'translateY(-100%)',
          }}
        >
          <div
            className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all duration-500 ${
              activeNodeIds.has(node.id) ? 'border-purple-400/60 shadow-lg shadow-purple-500/20' : 'border-primary/20'
            }`}
            style={{ backgroundColor: (node.color ?? '#6366f1') + '20' }}
          >
            {node.icon && node.icon.length <= 2 ? node.icon : node.label[0]?.toUpperCase()}
          </div>
          <span className="text-[10px] text-muted-foreground/50 mt-1 truncate max-w-[80px] text-center" title={node.label}>
            {node.label}
          </span>
        </div>
      ))}

      {/* Consumer node labels rendered as HTML overlays */}
      {consumers.map(node => (
        <div
          key={`label-cons-${node.id}`}
          className="absolute flex flex-col items-center"
          style={{
            left: node.x - 40,
            top: node.y + NODE_RADIUS + 4,
            width: 80,
          }}
        >
          <div
            className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all duration-500 ${
              activeNodeIds.has(node.id) ? 'border-purple-400/60 shadow-lg shadow-purple-500/20' : 'border-primary/20'
            }`}
            style={{ backgroundColor: (node.color ?? '#6366f1') + '20' }}
          >
            {node.icon && node.icon.length <= 2 ? node.icon : node.label[0]?.toUpperCase()}
          </div>
          <span className="text-[10px] text-muted-foreground/50 mt-1 truncate max-w-[80px] text-center" title={node.label}>
            {node.label}
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
                <span className="text-[9px] font-mono text-muted-foreground/60">
                  {EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {seenTypes.length > MAX_LEGEND_ITEMS && (
            <div className="text-[9px] font-mono text-muted-foreground/40 pt-0.5">
              +{seenTypes.length - MAX_LEGEND_ITEMS} more
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {events.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-purple-500/5 border border-purple-500/15 flex items-center justify-center">
              <motion.svg
                className="w-5 h-5 text-purple-400/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </motion.svg>
            </div>
            <p className="text-sm text-muted-foreground/40 flex items-center justify-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              Waiting for events...
            </p>
            <p className="text-xs text-muted-foreground/25 mt-1">Click &quot;Test Flow&quot; to see it in action</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

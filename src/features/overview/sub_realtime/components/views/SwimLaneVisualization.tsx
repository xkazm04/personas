import { useMemo, useRef, useEffect, useId } from 'react';
import type { RealtimeEvent, AnimationMap } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { useAnimatedEvents } from '@/hooks/realtime/useAnimatedEvents';
import type { DiscoveredSource } from '../../libs/visualizationHelpers';
import {
  FADE_AFTER_MS,
  colorForSource, labelForSource,
  DEFAULT_TOOLS, DEFAULT_PERSONAS, EVENT_TYPE_LABELS,
  iconChar,
} from '../../libs/visualizationHelpers';
import EventLogSidebar from '../panels/EventLogSidebar';
import { useTranslation } from '@/i18n/useTranslation';

/*
 * Swim Lane visualization -- horizontal left-to-right flow.
 * Sources are stacked vertically on the left, agents on the right.
 * Events travel as particles through horizontal lanes from source -> hub -> agent.
 * Philosophy: linear time-flow, easy to trace which source talks to which agent.
 */

/* ---------- Layout ---------- */
const PAD_X = 8;
const PAD_Y = 6;
const LANE_W = 100 - PAD_X * 2;
const HUB_X = 50;
const SRC_X = PAD_X + 4;
const AGT_X = 100 - PAD_X - 4;
const NODE_R = 2.2;

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
  animationMapRef: React.RefObject<AnimationMap>;
  animTick: number;
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

interface LaneNode {
  id: string;
  label: string;
  icon: string | null;
  color: string;
  y: number;
  sizeFactor?: number;
}

function distributeVertically(
  items: { id: string; label: string; icon: string | null; color: string; sizeFactor?: number }[],
  topY: number,
  bottomY: number,
): LaneNode[] {
  const count = items.length;
  if (count === 0) return [];
  if (count === 1) return [{ ...items[0]!, y: (topY + bottomY) / 2 }];
  const step = (bottomY - topY) / (count - 1);
  return items.map((item, i) => ({ ...item, y: topY + i * step }));
}

export default function SwimLaneVisualization({ events, personas, animationMapRef, animTick, onSelectEvent }: Props) {
  const { t } = useTranslation();
  const uid = useId();

  /* ---------- source discovery ---------- */
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

  const sourceNodes = useMemo(() => {
    const disc = discoveredRef.current;
    if (disc.size === 0) {
      const raw = DEFAULT_TOOLS.slice(0, 8).map(t => ({ ...t, sizeFactor: 1 }));
      return distributeVertically(raw, PAD_Y + 4, 100 - PAD_Y - 4);
    }
    const now = Date.now();
    const sources = Array.from(disc.values()).sort((a, b) => b.count - a.count).slice(0, 10);
    const maxC = Math.max(1, ...sources.map(s => s.count));
    const raw = sources.map(s => {
      const age = now - s.lastSeen;
      const sf = 0.3 + 0.7 * (s.count / maxC);
      return { id: s.id, label: s.label, icon: null, color: colorForSource(s.id), sizeFactor: age > FADE_AFTER_MS ? sf * 0.5 : sf };
    });
    return distributeVertically(raw, PAD_Y + 4, 100 - PAD_Y - 4);
  }, [events.length]);

  const agentNodes = useMemo(() => {
    const raw = personas.length > 0
      ? personas.slice(0, 8).map(p => ({ id: p.id, label: p.name, icon: p.icon, color: p.color ?? '#8b5cf6' }))
      : DEFAULT_PERSONAS.slice(0, 6);
    return distributeVertically(raw, PAD_Y + 4, 100 - PAD_Y - 4);
  }, [personas]);

  /* ---------- position maps ---------- */
  const srcMap = useMemo(() => { const m = new Map<string, number>(); for (const n of sourceNodes) m.set(n.id, n.y); return m; }, [sourceNodes]);
  const agtMap = useMemo(() => { const m = new Map<string, number>(); for (const n of agentNodes) m.set(n.id, n.y); return m; }, [agentNodes]);

  const animatedEvents = useAnimatedEvents(events, animationMapRef.current, animTick);
  const inFlightCount = animatedEvents.length;

  const getSrcY = (evt: RealtimeEvent) => {
    const key = evt.source_id || evt.source_type;
    if (key) { const y = srcMap.get(key) ?? srcMap.get(`def:${key}`); if (y !== undefined) return y; }
    const fallbackIdx = evt.id.charCodeAt(0) % sourceNodes.length;
    return sourceNodes[fallbackIdx]?.y ?? 50;
  };

  const getAgtY = (evt: RealtimeEvent) => {
    if (evt.target_persona_id) { const y = agtMap.get(evt.target_persona_id); if (y !== undefined) return y; }
    const idx = evt.id.charCodeAt(0) % agentNodes.length;
    return agentNodes[idx]?.y ?? 50;
  };

  return (
    <div className="w-full h-full flex min-h-[280px]">
      <div className="flex-1 relative">
        <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id={`${uid}-glow`}>
              <feGaussianBlur stdDeviation="0.8" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id={`${uid}-laneGrad`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(139,92,246,0.04)" />
              <stop offset="50%" stopColor="rgba(6,182,212,0.06)" />
              <stop offset="100%" stopColor="rgba(139,92,246,0.04)" />
            </linearGradient>
          </defs>

          {/* Background lane stripes */}
          {sourceNodes.map((node, i) => (
            <rect
              key={node.id}
              x={PAD_X} y={node.y - 3} width={LANE_W} height={6}
              fill={i % 2 === 0 ? 'rgba(255,255,255,0.008)' : 'transparent'}
              rx={1}
            />
          ))}

          {/* Hub column */}
          <rect x={HUB_X - 3} y={PAD_Y} width={6} height={100 - PAD_Y * 2} rx={1.5} fill="rgba(6,182,212,0.03)" stroke="rgba(6,182,212,0.08)" strokeWidth="0.15" />
          <text x={HUB_X} y={PAD_Y + 2.5} textAnchor="middle" fill="rgba(6,182,212,0.5)" fontSize="1.6" fontFamily="monospace" letterSpacing="0.15em">HUB</text>

          {/* Source nodes (left) */}
          {sourceNodes.map(node => {
            const sf = node.sizeFactor ?? 1;
            const isDisc = !node.id.startsWith('def:');
            const r = isDisc ? 1.8 + sf * 0.8 : NODE_R;
            const opacity = isDisc ? 0.5 + sf * 0.5 : 0.4;
            return (
              <g key={node.id} opacity={opacity}>
                <line x1={SRC_X + r + 0.5} y1={node.y} x2={HUB_X - 3} y2={node.y} stroke={`${node.color}10`} strokeWidth="0.1" strokeDasharray="0.5 1" />
                <rect x={SRC_X - r} y={node.y - r} width={r * 2} height={r * 2} rx={0.6} fill={`${node.color}15`} stroke={node.color} strokeWidth="0.2" />
                <text x={SRC_X} y={node.y + 0.3} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.7)" fontSize="1.6" fontFamily="monospace">
                  {node.label.charAt(0).toUpperCase()}
                </text>
                <text x={SRC_X - r - 1} y={node.y + 0.3} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize="1.3" fontFamily="monospace">
                  {node.label}
                </text>
              </g>
            );
          })}

          {/* Agent nodes (right) */}
          {agentNodes.map(node => (
            <g key={node.id}>
              <line x1={HUB_X + 3} y1={node.y} x2={AGT_X - NODE_R - 0.5} y2={node.y} stroke={`${node.color}10`} strokeWidth="0.1" strokeDasharray="0.5 1" />
              <circle cx={AGT_X} cy={node.y} r={NODE_R} fill={`${node.color}18`} stroke={node.color} strokeWidth="0.25" />
              <circle cx={AGT_X} cy={node.y} r={NODE_R * 0.45} fill={node.color} opacity={0.5} />
              <text x={AGT_X} y={node.y + 0.4} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.85)" fontSize="2" fontFamily="monospace">
                {iconChar({ id: node.id, label: node.label, icon: node.icon, color: node.color, x: 0, y: 0 })}
              </text>
              <text x={AGT_X + NODE_R + 1.2} y={node.y + 0.3} textAnchor="start" fill="rgba(255,255,255,0.45)" fontSize="1.3" fontFamily="monospace">
                {node.label}
              </text>
            </g>
          ))}

          {/* Event particles flowing left->hub->right */}
          {animatedEvents.map(({ event: evt, animationId, phase }) => {
            const srcY = getSrcY(evt);
            const agtY = getAgtY(evt);
            const color = evt.status === 'failed' ? '#ef4444' : (EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8');

            let targetX: number, targetY: number;
            switch (phase) {
              case 'entering':
                targetX = HUB_X; targetY = srcY; break;
              case 'on-bus':
                targetX = HUB_X; targetY = (srcY + agtY) / 2; break;
              case 'delivering': default:
                targetX = AGT_X; targetY = agtY; break;
            }

            return (
              <g key={animationId} onClick={() => onSelectEvent(evt)} style={{ cursor: 'pointer' }}>
                {/* Trail line */}
                <line className="animate-fade-in"
                  stroke={color} strokeWidth="0.12"
                />
                {/* Outer glow */}
                <circle className="animate-fade-slide-in"
                  r={1.6} fill={color}
                />
                {/* Main particle */}
                <circle className="animate-fade-slide-in"
                  r={0.9} fill={color} filter={`url(#${uid}-glow)`}
                />
                {/* Core */}
                <circle className="animate-fade-slide-in"
                  r={0.35} fill="white"
                />
                {/* Event label */}
                <text className="animate-fade-slide-in"
                  textAnchor="middle" fill={color} fontSize="1.1" fontFamily="monospace"
                >
                  {EVENT_TYPE_LABELS[evt.event_type] ?? evt.event_type.replace(/_/g, ' ')}
                </text>
                {/* Impact ring */}
                {phase === 'delivering' && (evt.status === 'completed' || evt.status === 'failed') && (
                  <circle className="animate-fade-slide-in"
                    cx={targetX} cy={targetY} fill="none" stroke={color} strokeWidth={0.12}
                  />
                )}
              </g>
            );
          })}

          {/* Stats */}
          <text x={HUB_X} y={100 - PAD_Y + 1} textAnchor="middle" fill={inFlightCount > 0 ? 'rgba(6,182,212,0.7)' : 'rgba(6,182,212,0.3)'} fontSize="1.6" fontFamily="monospace">
            {inFlightCount > 0 ? `${inFlightCount} in-flight` : 'idle'}
          </text>
        </svg>

        {events.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 bg-background/40 backdrop-blur-sm border border-primary/10 rounded-2xl px-6 py-4">
              <span className="text-sm text-muted-foreground/40 font-mono">{t.overview.realtime_idle.idle}</span>
              <span className="text-xs text-muted-foreground/30">Click <span className="text-purple-400/60 font-medium">Test Flow</span> to simulate traffic</span>
            </div>
          </div>
        )}
      </div>

      <EventLogSidebar events={events} onSelectEvent={onSelectEvent} />
    </div>
  );
}

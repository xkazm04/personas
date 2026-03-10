import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import type { ReturnFlow } from './libs/visualizationHelpers';
import { CX, CY, RETURN_FLOW_MS } from './libs/visualizationHelpers';

// ── Inbound particles (tool -> center -> persona) ────────────────

interface InboundParticlesProps {
  activeEvents: RealtimeEvent[];
  uid: string;
  getSourcePos: (evt: RealtimeEvent) => { x: number; y: number };
  getTargetPos: (evt: RealtimeEvent) => { x: number; y: number } | null;
  onSelectEvent: (evt: RealtimeEvent | null) => void;
}

export function InboundParticles({ activeEvents, uid, getSourcePos, getTargetPos, onSelectEvent }: InboundParticlesProps) {
  return (
    <>
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
    </>
  );
}

// ── Return-flow particles (persona -> center -> tool) ────────────

export function ReturnFlowParticles({ flows, uid }: { flows: ReturnFlow[]; uid: string }) {
  return (
    <AnimatePresence>
      {flows.map((flow) => (
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
  );
}

import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { CX, CY, RETURN_FLOW_MS } from '../../libs/visualizationHelpers';
import type { ReturnFlow } from '../../libs/visualizationHelpers';
import { TRAIL_DURATION, COMET_TAIL_STEPS } from './EventBusTypes';

interface InboundProps {
  activeEvents: RealtimeEvent[];
  uid: string;
  getSrc: (evt: RealtimeEvent) => { x: number; y: number };
  getTgt: (evt: RealtimeEvent) => { x: number; y: number } | null;
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

export function InboundCometTrails({ activeEvents, uid, getSrc, getTgt, onSelectEvent }: InboundProps) {
  return (
    <>
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
    </>
  );
}

export function ReturnFlowComets({ flows, uid }: { flows: ReturnFlow[]; uid: string }) {
  return (
    <AnimatePresence>
      {flows.map(flow => (
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
  );
}

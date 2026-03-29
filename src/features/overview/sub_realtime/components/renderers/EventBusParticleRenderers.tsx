import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { CX, CY } from '../../libs/visualizationHelpers';
import type { ReturnFlow } from '../../libs/visualizationHelpers';
import { COMET_TAIL_STEPS } from './EventBusTypes';
import type { AnimatedEvent } from '@/hooks/realtime/useAnimatedEvents';

interface InboundProps {
  activeEvents: AnimatedEvent[];
  uid: string;
  getSrc: (evt: RealtimeEvent) => { x: number; y: number };
  getTgt: (evt: RealtimeEvent) => { x: number; y: number } | null;
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

export function InboundCometTrails({ activeEvents, uid, getSrc: _getSrc, getTgt, onSelectEvent }: InboundProps) {
  return (
    <>
      {activeEvents.map(({ event: evt, animationId, phase }) => {
        const tgt = getTgt(evt);
        const color = evt.status === 'failed' ? '#ef4444' : (EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8');
        let tx: number, ty: number;
        switch (phase) {
          case 'entering': case 'on-bus': tx = CX; ty = CY; break;
          case 'delivering': default: tx = tgt?.x ?? CX; ty = tgt?.y ?? CY;
        }
        return (
          <g key={animationId} onClick={() => onSelectEvent(evt)} style={{ cursor: 'pointer' }}>
            {Array.from({ length: COMET_TAIL_STEPS }, (_, i) => {
              const scale = 1 - (i / COMET_TAIL_STEPS);
              return (
                <circle className="animate-fade-slide-in"
                  key={i}
                  r={0.6 + scale * 0.8} fill={color}
                />
              );
            })}
            <circle className="animate-fade-slide-in"
              r={1.3} fill={color} filter={`url(#${uid}-cometGlow)`}
            />
            <circle className="animate-fade-slide-in"
              r={0.45} fill="white"
            />
            {phase === 'delivering' && (evt.status === 'completed' || evt.status === 'failed') && (
              <>
                <circle className="animate-fade-slide-in"
                  cx={tx} cy={ty} fill="none" stroke={color} strokeWidth={0.15}
                />
                <circle className="animate-fade-slide-in"
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
    <>
      {flows.map(flow => (
        <g className="animate-fade-slide-in" key={flow.id}>
          {[0.15, 0.25, 0.35].map((op, i) => (
            <circle className="animate-fade-slide-in"
              key={i} r={0.5 + (2 - i) * 0.2} fill={flow.color} opacity={op}
            />
          ))}
          <circle className="animate-fade-slide-in"
            r={0.9} fill={flow.color} filter={`url(#${uid}-softGlow)`}
          />
          <circle className="animate-fade-slide-in"
            r={0.3} fill="white"
          />
        </g>
      ))}
    </>
  );
}

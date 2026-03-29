import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import type { ReturnFlow } from '../../libs/visualizationHelpers';
import { CX, CY } from '../../libs/visualizationHelpers';
import type { AnimatedEvent } from '@/hooks/realtime/useAnimatedEvents';

interface InboundParticlesProps {
  activeEvents: AnimatedEvent[];
  uid: string;
  getSourcePos: (evt: RealtimeEvent) => { x: number; y: number };
  getTargetPos: (evt: RealtimeEvent) => { x: number; y: number } | null;
  onSelectEvent: (evt: RealtimeEvent | null) => void;
}

export function InboundParticles({ activeEvents, uid, getSourcePos: _getSourcePos, getTargetPos, onSelectEvent }: InboundParticlesProps) {
  return (
    <>
      {activeEvents.map(({ event: evt, animationId, phase }) => {
        const tgt = getTargetPos(evt);
        const color = EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8';
        const pColor = evt.status === 'failed' ? '#ef4444' : color;

        let tx: number, ty: number;
        switch (phase) {
          case 'entering': case 'on-bus':
            tx = CX; ty = CY; break;
          case 'delivering': default:
            tx = tgt?.x ?? CX; ty = tgt?.y ?? CY;
        }

        return (
          <g key={animationId} onClick={() => onSelectEvent(evt)} style={{ cursor: 'pointer' }}>
            <circle className="animate-fade-slide-in"
              r={1.8} fill={pColor}
            />
            <circle className="animate-fade-slide-in"
              r={1} fill={pColor} filter={`url(#${uid}-glow)`}
            />
            <circle className="animate-fade-slide-in"
              r={0.35} fill="white"
            />
            {phase === 'delivering' && (evt.status === 'completed' || evt.status === 'failed') && (
              <circle className="animate-fade-slide-in"
                cx={tx} cy={ty} fill="none" stroke={pColor} strokeWidth={0.25}
              />
            )}
          </g>
        );
      })}
    </>
  );
}

export function ReturnFlowParticles({ flows, uid }: { flows: ReturnFlow[]; uid: string }) {
  return (
    <>
      {flows.map((flow) => (
        <g className="animate-fade-slide-in" key={flow.id}>
          <circle className="animate-fade-slide-in"
            r={1.4} fill={flow.color} opacity={0.15}
          />
          <circle className="animate-fade-slide-in"
            r={0.8} fill={flow.color} filter={`url(#${uid}-glow)`}
          />
          <circle className="animate-fade-slide-in"
            r={0.3} fill="white"
          />
          <circle className="animate-fade-slide-in"
            cx={flow.toX} cy={flow.toY}
            fill="none" stroke={flow.color} strokeWidth={0.2}
          />
        </g>
      ))}
    </>
  );
}

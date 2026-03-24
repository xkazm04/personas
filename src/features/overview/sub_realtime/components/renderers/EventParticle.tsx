import { memo, useMemo, useCallback } from 'react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';

interface Props {
  event: RealtimeEvent;
  sourcePos: { x: number; y: number };
  busY: number;
  targetPos: { x: number; y: number } | null;
  color: string;
  onClick: () => void;
}

const PARTICLE_R = 5;
const HIT_AREA_R = 12;
const TRAIL_COUNT = 2;

function EventParticleComponent({ event, sourcePos, busY, targetPos, color, onClick }: Props) {
  const position = useMemo(() => {
    switch (event._phase) {
      case 'entering':
        return { cx: sourcePos.x, cy: busY };
      case 'on-bus':
        return { cx: targetPos?.x ?? sourcePos.x, cy: busY };
      case 'delivering':
        return { cx: targetPos?.x ?? sourcePos.x, cy: targetPos?.y ?? busY };
      case 'done':
      default:
        return { cx: targetPos?.x ?? sourcePos.x, cy: targetPos?.y ?? busY };
    }
  }, [event._phase, sourcePos, busY, targetPos]);

  const isFailed = event.status === 'failed';
  const isCompleted = event.status === 'completed';
  const particleColor = isFailed ? '#ef4444' : color;
  const showBurst = event._phase === 'delivering' && (isCompleted || isFailed);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
  }, [onClick]);

  return (
    <g onClick={onClick} onKeyDown={handleKeyDown} tabIndex={0} role="button" aria-label={`Event: ${event.event_type} -- ${event.status}`} style={{ cursor: 'pointer' }}>
      <circle className="animate-fade-in" r={HIT_AREA_R} fill="transparent" />
      {TRAIL_COUNT > 0 && event._phase !== 'done' && (
        <>
          {Array.from({ length: TRAIL_COUNT }).map((_, i) => (
            <circle className="animate-fade-in" key={`trail-${i}`} r={PARTICLE_R - (i + 1)} fill={particleColor} opacity={0.15 - i * 0.05} />
          ))}
        </>
      )}
      <circle className="animate-fade-in" r={PARTICLE_R} fill={particleColor} filter="url(#particleGlow)" />
      <circle className="animate-fade-slide-in" r={PARTICLE_R * 0.4} fill="white" opacity={0.8} />
      {showBurst && (
        <circle className="animate-fade-slide-in" cx={position.cx} cy={position.cy} fill="none" stroke={particleColor} strokeWidth={1.5} />
      )}
    </g>
  );
}

const EventParticle = memo(EventParticleComponent);
export default EventParticle;

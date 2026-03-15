import { useEffect, useRef } from 'react';
import { RING_SIZE, RING_STROKE, RING_RADIUS, RING_CIRCUMFERENCE } from './triggerListTypes';

export function RadialCountdownRing({
  remaining,
  total,
  firing,
  accentColor,
  children,
}: {
  remaining: number;
  total: number;
  firing: boolean;
  accentColor: string;
  children: React.ReactNode;
}) {
  const progressRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(Date.now());
  const startRemainingRef = useRef(remaining);

  // Reset animation reference point when remaining jumps (e.g. trigger recalculation)
  useEffect(() => {
    startTimeRef.current = Date.now();
    startRemainingRef.current = remaining;
  }, [remaining]);

  // Smooth progress via requestAnimationFrame
  useEffect(() => {
    if (firing) return;

    const animate = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const currentRemaining = Math.max(startRemainingRef.current - elapsed, 0);
      const fraction = total > 0 ? Math.max(currentRemaining / total, 0) : 0;
      const offset = RING_CIRCUMFERENCE * (1 - fraction);

      if (progressRef.current) {
        progressRef.current.style.strokeDashoffset = `${offset}`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [total, firing]);

  const strokeColor = firing ? '#34d399' : accentColor;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        className={`-rotate-90 ${firing ? 'animate-pulse' : ''}`}
      >
        {/* Track */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          className="text-primary/8"
        />
        {/* Progress */}
        <circle
          ref={progressRef}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE}
          style={{ transition: firing ? 'stroke 0.3s' : 'none' }}
        />
      </svg>
      {/* Text label centered inside */}
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

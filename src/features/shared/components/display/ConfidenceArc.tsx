import { useMemo } from 'react';
import { AnimatedCounter } from './AnimatedCounter';

interface ConfidenceArcProps {
  /** Confidence value 0–100 */
  value: number;
  /** Width of the arc SVG (default 24) */
  width?: number;
  /** Height of the arc SVG (default 14) */
  height?: number;
  /** Show the percentage label below the arc (default false) */
  showLabel?: boolean;
  className?: string;
}

/**
 * Semi-circular arc gauge for displaying confidence metrics.
 * Uses branded palette: violet (low) → amber (medium) → emerald (high).
 * At 100% confidence, a subtle shimmer animation plays on the arc.
 */
export function ConfidenceArc({ value, width = 24, height = 14, showLabel = false, className = '' }: ConfidenceArcProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));

  // Arc geometry: semi-circle from left to right
  const cx = width / 2;
  const cy = height;
  const r = Math.min(cx - 1, height - 1);
  const strokeWidth = 2;

  // Background arc path (full semi-circle, left to right)
  const bgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  // Foreground arc: fraction of semi-circle
  const fraction = pct / 100;
  const angle = Math.PI * fraction;
  const endX = cx - r * Math.cos(angle);
  const endY = cy - r * Math.sin(angle);
  const largeArc = fraction > 0.5 ? 1 : 0;
  const fgPath = fraction > 0 ? `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}` : '';

  // Gradient ID unique per instance
  const gradientId = useMemo(() => `conf-arc-${Math.random().toString(36).slice(2, 8)}`, []);

  // Color stops: violet (low) → amber (mid) → emerald (high)
  const stops = pct < 40
    ? [
        { offset: '0%', color: '#8b5cf6' },   // violet-500
        { offset: '100%', color: '#a78bfa' },  // violet-400
      ]
    : pct < 70
    ? [
        { offset: '0%', color: '#8b5cf6' },   // violet-500
        { offset: '50%', color: '#f59e0b' },   // amber-500
        { offset: '100%', color: '#fbbf24' },  // amber-400
      ]
    : [
        { offset: '0%', color: '#8b5cf6' },   // violet-500
        { offset: '40%', color: '#f59e0b' },   // amber-500
        { offset: '100%', color: '#10b981' },  // emerald-500
      ];

  const isFullConfidence = pct === 100;

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        className={isFullConfidence ? 'animate-confidence-shimmer' : ''}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            {stops.map((s, i) => (
              <stop key={i} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
        </defs>
        {/* Background track */}
        <path
          d={bgPath}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          className="text-secondary/30"
        />
        {/* Foreground fill */}
        {fraction > 0 && (
          <path
            d={fgPath}
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
      {showLabel && (
        <AnimatedCounter
          value={pct}
          formatFn={(v) => `${Math.round(v)}%`}
          className="text-[9px] font-mono text-muted-foreground/70 leading-none mt-0.5"
        />
      )}
    </div>
  );
}

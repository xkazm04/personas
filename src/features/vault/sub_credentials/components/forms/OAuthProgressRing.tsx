import { useMemo } from 'react';
import { Shield, Check } from 'lucide-react';

export type OAuthRingPhase = 'waiting' | 'polling' | 'success';

interface OAuthProgressRingProps {
  /** Current visual phase of the ring */
  phase: OAuthRingPhase;
  /** Status message displayed below the ring */
  message?: string;
  /** Size of the ring in pixels (default 64) */
  size?: number;
}

const RING_STROKE = 3;

/**
 * Animated SVG progress ring for OAuth consent flows.
 *
 * Three visual states:
 * - **waiting**: indeterminate spin while browser consent page is open
 * - **polling**: pulsing ring indicating active polling
 * - **success**: ring fills and morphs into a checkmark
 */
export function OAuthProgressRing({
  phase,
  message,
  size = 64,
}: OAuthProgressRingProps) {
  const r = (size - RING_STROKE * 2) / 2;
  const circumference = 2 * Math.PI * r;

  // Unique gradient ID per instance
  const gradientId = useMemo(
    () => `oauth-ring-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  const ringClasses: Record<OAuthRingPhase, string> = {
    waiting: 'oauth-ring-spin',
    polling: 'oauth-ring-pulse',
    success: 'oauth-ring-success',
  };

  const gradientColors: Record<OAuthRingPhase, [string, string]> = {
    waiting: ['#3b82f6', '#8b5cf6'],  // blue → violet
    polling: ['#f59e0b', '#8b5cf6'],  // amber → violet
    success: ['#10b981', '#34d399'],  // emerald-500 → emerald-400
  };

  const [c1, c2] = gradientColors[phase];

  const iconSize = size * 0.38;

  return (
    <div
      className="flex flex-col items-center gap-2.5"
      role="status"
      aria-label={message ?? 'OAuth authorization in progress'}
    >
      {/* Ring + center icon */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          fill="none"
          className={ringClasses[phase]}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={c1} />
              <stop offset="100%" stopColor={c2} />
            </linearGradient>
          </defs>

          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="currentColor"
            strokeWidth={RING_STROKE}
            fill="none"
            className="text-primary/8"
          />

          {/* Animated foreground ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={`url(#${gradientId})`}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={
              phase === 'success' ? 0 : circumference * 0.7
            }
            className={
              phase === 'success'
                ? 'oauth-ring-fill-anim'
                : ''
            }
            style={{ transformOrigin: 'center' }}
          />

          {/* Checkmark for success state */}
          {phase === 'success' && (
            <polyline
              points={`${size * 0.33},${size * 0.52} ${size * 0.45},${size * 0.64} ${size * 0.67},${size * 0.38}`}
              fill="none"
              stroke="#10b981"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="oauth-ring-check-draw"
            />
          )}
        </svg>

        {/* Center provider icon (hidden on success – checkmark replaces it) */}
        {phase !== 'success' && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            {phase === 'waiting' ? (
              <Shield
                style={{ width: iconSize, height: iconSize }}
                className="text-blue-400/80"
              />
            ) : (
              <Shield
                style={{ width: iconSize, height: iconSize }}
                className="text-amber-400/80 oauth-icon-pulse"
              />
            )}
          </div>
        )}

        {/* Success check icon (for screen readers; visual checkmark is the SVG polyline) */}
        {phase === 'success' && (
          <span className="sr-only">
            <Check aria-hidden />
            Authorization complete
          </span>
        )}
      </div>

      {/* Status message */}
      {message && (
        <p
          className={`text-sm text-center max-w-[220px] leading-snug ${
            phase === 'success'
              ? 'text-emerald-300'
              : 'text-foreground'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

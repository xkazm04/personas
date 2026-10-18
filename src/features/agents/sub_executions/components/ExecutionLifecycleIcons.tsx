/**
 * Custom SVG execution lifecycle illustration: the Running state (flowing data
 * streams, rising particles + rotating ring) in the brand violet-to-blue
 * gradient.
 *
 * This file used to carry four states plus a `StatusIcon` switch; only
 * `RunningIcon` had a consumer (ReplayTerminalPanel). Idle, Completed, Failed
 * and StatusIcon were removed on 2026-10-19 with zero importers in src/,
 * scripts/ or tests - recover them from git history if a surface needs them.
 *
 * The animation honours `prefers-reduced-motion: reduce` and degrades to static.
 * Accepts `size` (default 48), optional `className`, and optional
 * `ariaLabel`. When `ariaLabel` is provided the SVG exposes role="img"; when
 * omitted the SVG is `aria-hidden`.
 */

interface IconProps {
  size?: number;
  className?: string;
  ariaLabel?: string;
}

const GRADIENT_ID_PREFIX = 'exec-lifecycle';

function ariaProps(label: string | undefined) {
  return label
    ? ({ role: 'img' as const, 'aria-label': label })
    : ({ 'aria-hidden': true as const });
}

/** Running — flowing data streams with rising particles and rotating ring. */
export function RunningIcon({ size = 48, className, ariaLabel }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-running`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} {...ariaProps(ariaLabel)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <style>{`
          .exec-run-ring { transform-origin: 24px 24px; animation: exec-run-spin 2s linear infinite; }
          .exec-run-particle { transform-origin: center; transform-box: fill-box; animation: exec-run-rise 2s ease-in-out infinite; }
          .exec-run-particle.p2 { animation-delay: 0.66s; }
          .exec-run-particle.p3 { animation-delay: 1.33s; }
          .exec-run-core { transform-origin: center; transform-box: fill-box; animation: exec-run-pulse 2s ease-in-out infinite; }
          @keyframes exec-run-spin { to { transform: rotate(360deg); } }
          @keyframes exec-run-rise { 0% { transform: translateY(6px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(-8px); opacity: 0; } }
          @keyframes exec-run-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
          @media (prefers-reduced-motion: reduce) {
            .exec-run-ring, .exec-run-particle, .exec-run-core { animation: none; }
          }
        `}</style>
      </defs>
      <circle
        className="exec-run-ring"
        cx="24" cy="24" r="20"
        stroke={`url(#${id})`} strokeWidth="2" fill="none" opacity="0.35"
        strokeDasharray="30 95" strokeLinecap="round"
      />
      <path d="M14 34 C14 26 20 24 20 16" stroke="#8b5cf6" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M24 36 C24 28 24 24 24 14" stroke={`url(#${id})`} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M34 34 C34 26 28 24 28 16" stroke="#3b82f6" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7" />
      <circle className="exec-run-particle p1" cx="20" cy="20" r="1.5" fill="#8b5cf6" />
      <circle className="exec-run-particle p2" cx="24" cy="24" r="2" fill={`url(#${id})`} />
      <circle className="exec-run-particle p3" cx="28" cy="20" r="1.5" fill="#3b82f6" />
      <circle cx="24" cy="14" r="3" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" />
      <circle className="exec-run-core" cx="24" cy="14" r="1" fill="#8b5cf6" />
    </svg>
  );
}

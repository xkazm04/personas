/**
 * Custom SVG execution lifecycle illustrations.
 *
 * Four states using the brand violet-to-blue gradient palette:
 * - Idle: dormant agent silhouette
 * - Running: flowing data streams
 * - Completed: checkmark constellation
 * - Failed: fractured circuit
 *
 * Each accepts `size` (default 48) and optional className.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const GRADIENT_ID_PREFIX = 'exec-lifecycle';

/** Idle — dormant agent silhouette with subtle glow. */
export function IdleIcon({ size = 48, className }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-idle`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" stopOpacity="0.6" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* Outer ring — dormant */}
      <circle cx="24" cy="24" r="20" stroke={`url(#${id})`} strokeWidth="1.5" strokeDasharray="4 3" fill="none" opacity="0.5" />
      {/* Agent silhouette — head */}
      <circle cx="24" cy="18" r="5" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" />
      {/* Agent silhouette — body */}
      <path d="M16 36 C16 28 32 28 32 36" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Subtle pulse dot */}
      <circle cx="24" cy="18" r="1.5" fill="#8b5cf6" opacity="0.4" />
    </svg>
  );
}

/** Running — flowing data streams with animated gradient feel. */
export function RunningIcon({ size = 48, className }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-running`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {/* Outer active ring */}
      <circle cx="24" cy="24" r="20" stroke={`url(#${id})`} strokeWidth="2" fill="none" opacity="0.3" />
      {/* Data stream lines — flowing upward */}
      <path d="M14 34 C14 26 20 24 20 16" stroke="#8b5cf6" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M24 36 C24 28 24 24 24 14" stroke={`url(#${id})`} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M34 34 C34 26 28 24 28 16" stroke="#3b82f6" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7" />
      {/* Flow particles */}
      <circle cx="20" cy="20" r="1.5" fill="#8b5cf6" opacity="0.8" />
      <circle cx="24" cy="24" r="2" fill={`url(#${id})`} />
      <circle cx="28" cy="20" r="1.5" fill="#3b82f6" opacity="0.8" />
      {/* Top active node */}
      <circle cx="24" cy="14" r="3" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" />
      <circle cx="24" cy="14" r="1" fill="#8b5cf6" />
    </svg>
  );
}

/** Completed — checkmark constellation with star-like nodes. */
export function CompletedIcon({ size = 48, className }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-completed`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      {/* Constellation ring */}
      <circle cx="24" cy="24" r="20" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.3" />
      {/* Checkmark */}
      <path d="M15 24 L21 30 L33 18" stroke={`url(#${id})`} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Star nodes — constellation points */}
      <circle cx="12" cy="16" r="1.5" fill="#8b5cf6" opacity="0.6" />
      <circle cx="36" cy="14" r="1" fill="#22c55e" opacity="0.5" />
      <circle cx="38" cy="30" r="1.5" fill="#3b82f6" opacity="0.4" />
      <circle cx="10" cy="32" r="1" fill="#8b5cf6" opacity="0.5" />
      <circle cx="24" cy="8" r="1" fill="#22c55e" opacity="0.6" />
      {/* Subtle connecting lines */}
      <line x1="12" y1="16" x2="15" y2="24" stroke="#8b5cf6" strokeWidth="0.5" opacity="0.2" />
      <line x1="36" y1="14" x2="33" y2="18" stroke="#22c55e" strokeWidth="0.5" opacity="0.2" />
    </svg>
  );
}

/** Failed — fractured circuit with broken connections. */
export function FailedIcon({ size = 48, className }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-failed`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      {/* Broken outer ring — dashed segments */}
      <path d="M24 4 A20 20 0 0 1 44 24" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.4" />
      <path d="M44 24 A20 20 0 0 1 24 44" stroke="#ef4444" strokeWidth="1.5" fill="none" opacity="0.3" />
      <path d="M24 44 A20 20 0 0 1 4 24" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.4" />
      <path d="M4 24 A20 20 0 0 1 24 4" stroke="#8b5cf6" strokeWidth="1.5" fill="none" opacity="0.3" />
      {/* Fractured circuit lines */}
      <path d="M16 16 L22 22" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" />
      <path d="M26 26 L32 32" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" />
      <path d="M32 16 L26 22" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 26 L16 32" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
      {/* Gap / fracture point */}
      <circle cx="24" cy="24" r="3" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.6" />
      {/* Spark particles */}
      <circle cx="22" cy="22" r="1" fill="#ef4444" opacity="0.7" />
      <circle cx="26" cy="26" r="1" fill="#ef4444" opacity="0.7" />
    </svg>
  );
}

/** Inline status icons (16x16) — smaller versions for use in lists and status badges. */
export function StatusIcon({ status, size = 16, className }: { status: string } & IconProps) {
  switch (status) {
    case 'running':
    case 'queued':
      return <RunningIcon size={size} className={className} />;
    case 'completed':
      return <CompletedIcon size={size} className={className} />;
    case 'failed':
    case 'incomplete':
      return <FailedIcon size={size} className={className} />;
    default:
      return <IdleIcon size={size} className={className} />;
  }
}

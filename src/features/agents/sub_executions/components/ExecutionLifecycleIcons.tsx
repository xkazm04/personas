/**
 * Custom SVG execution lifecycle illustrations.
 *
 * Four states using the brand violet-to-blue gradient palette:
 * - Idle: dormant agent silhouette (slow breathing pulse)
 * - Running: flowing data streams (rising particles + rotating ring)
 * - Completed: checkmark constellation (one-shot draw-on)
 * - Failed: fractured circuit (one-shot mount shake)
 *
 * All animations honor `prefers-reduced-motion: reduce` and degrade to static.
 * Each accepts `size` (default 48), optional `className`, and optional
 * `ariaLabel`. When `ariaLabel` is provided the SVG exposes role="img"; when
 * omitted the SVG is `aria-hidden`.
 */

import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

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

/** Idle — dormant agent silhouette with slow breathing pulse. */
export function IdleIcon({ size = 48, className, ariaLabel }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-idle`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} {...ariaProps(ariaLabel)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" stopOpacity="0.6" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0.3" />
        </linearGradient>
        <style>{`
          .exec-idle-breathe { animation: exec-idle-breathe 6s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
          @keyframes exec-idle-breathe { 0%,100% { opacity: 0.4; } 50% { opacity: 0.95; } }
          @media (prefers-reduced-motion: reduce) { .exec-idle-breathe { animation: none; } }
        `}</style>
      </defs>
      <circle cx="24" cy="24" r="20" stroke={`url(#${id})`} strokeWidth="1.5" strokeDasharray="4 3" fill="none" opacity="0.5" />
      <circle cx="24" cy="18" r="5" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" />
      <path d="M16 36 C16 28 32 28 32 36" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle className="exec-idle-breathe" cx="24" cy="18" r="1.5" fill="#8b5cf6" />
    </svg>
  );
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

/** Completed — checkmark constellation with one-shot draw-on. */
export function CompletedIcon({ size = 48, className, ariaLabel }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-completed`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} {...ariaProps(ariaLabel)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22c55e" />
        </linearGradient>
        <style>{`
          .exec-done-check { stroke-dasharray: 32; stroke-dashoffset: 32; animation: exec-done-draw 520ms cubic-bezier(0.65, 0, 0.35, 1) forwards; }
          @keyframes exec-done-draw { to { stroke-dashoffset: 0; } }
          @media (prefers-reduced-motion: reduce) {
            .exec-done-check { stroke-dashoffset: 0; animation: none; }
          }
        `}</style>
      </defs>
      <circle cx="24" cy="24" r="20" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.3" />
      <path
        className="exec-done-check"
        d="M15 24 L21 30 L33 18"
        stroke={`url(#${id})`} strokeWidth="2.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="12" cy="16" r="1.5" fill="#8b5cf6" opacity="0.6" />
      <circle cx="36" cy="14" r="1" fill="#22c55e" opacity="0.5" />
      <circle cx="38" cy="30" r="1.5" fill="#3b82f6" opacity="0.4" />
      <circle cx="10" cy="32" r="1" fill="#8b5cf6" opacity="0.5" />
      <circle cx="24" cy="8" r="1" fill="#22c55e" opacity="0.6" />
      <line x1="12" y1="16" x2="15" y2="24" stroke="#8b5cf6" strokeWidth="0.5" opacity="0.2" />
      <line x1="36" y1="14" x2="33" y2="18" stroke="#22c55e" strokeWidth="0.5" opacity="0.2" />
    </svg>
  );
}

/** Failed — fractured circuit with one-shot mount shake. */
export function FailedIcon({ size = 48, className, ariaLabel }: IconProps) {
  const id = `${GRADIENT_ID_PREFIX}-failed`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} {...ariaProps(ariaLabel)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
        <style>{`
          .exec-fail-shake { transform-origin: 24px 24px; animation: exec-fail-shake 160ms ease-out 1; }
          @keyframes exec-fail-shake { 0% { transform: translateX(0); } 25% { transform: translateX(-2px); } 50% { transform: translateX(2px); } 75% { transform: translateX(-1px); } 100% { transform: translateX(0); } }
          @media (prefers-reduced-motion: reduce) { .exec-fail-shake { animation: none; } }
        `}</style>
      </defs>
      <g className="exec-fail-shake">
        <path d="M24 4 A20 20 0 0 1 44 24" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.4" />
        <path d="M44 24 A20 20 0 0 1 24 44" stroke="#ef4444" strokeWidth="1.5" fill="none" opacity="0.3" />
        <path d="M24 44 A20 20 0 0 1 4 24" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.4" />
        <path d="M4 24 A20 20 0 0 1 24 4" stroke="#8b5cf6" strokeWidth="1.5" fill="none" opacity="0.3" />
        <path d="M16 16 L22 22" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" />
        <path d="M26 26 L32 32" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" />
        <path d="M32 16 L26 22" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 26 L16 32" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="24" r="3" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" opacity="0.6" />
        <circle cx="22" cy="22" r="1" fill="#ef4444" opacity="0.7" />
        <circle cx="26" cy="26" r="1" fill="#ef4444" opacity="0.7" />
      </g>
    </svg>
  );
}

/** Inline status icons (16x16) — smaller versions for use in lists and status badges. */
export function StatusIcon({ status, size = 16, className }: { status: string } & IconProps) {
  const { t } = useTranslation();
  const label = tokenLabel(t, 'execution', status);
  switch (status) {
    case 'running':
    case 'queued':
      return <RunningIcon size={size} className={className} ariaLabel={label} />;
    case 'completed':
      return <CompletedIcon size={size} className={className} ariaLabel={label} />;
    case 'failed':
    case 'incomplete':
      return <FailedIcon size={size} className={className} ariaLabel={label} />;
    default:
      return <IdleIcon size={size} className={className} ariaLabel={label} />;
  }
}

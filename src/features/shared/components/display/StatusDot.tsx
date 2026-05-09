import type { ReactNode } from 'react';

/* StatusDot — accessibility-first state indicator.
 *
 * Pairs each state with a *distinct shape silhouette* so users with color-vision
 * deficiencies (≈8% of the male population — WCAG 1.4.1) can distinguish state
 * without relying on hue alone. Carries a required `label` rendered as sr-only
 * text plus an aria-label on the wrapper, so assistive tech reports the state
 * name even when the visual is inert decoration.
 *
 * Two semantic axes:
 *   - kind="connection" — live | paused | offline
 *   - kind="severity"   — critical | warning | info
 *
 * The shape mapping is intentionally fixed (not theme-able) — silhouette is
 * load-bearing for a11y and must remain consistent across the app.
 */

export type ConnectionState = 'live' | 'paused' | 'offline';
export type SeverityState = 'critical' | 'warning' | 'info';

export type StatusDotKind = 'connection' | 'severity';

export interface StatusDotProps {
  kind: StatusDotKind;
  /** Connection or severity state — type-narrowed at the call site via `kind`. */
  state: ConnectionState | SeverityState;
  /** Required, used as sr-only text + aria-label. Pass an i18n-resolved string. */
  label: string;
  /** Pulse the live indicator. Ignored for non-live states. Defaults to true. */
  pulse?: boolean;
  /** Adds an optional visible label after the shape. */
  children?: ReactNode;
  className?: string;
  /** Visual size — `sm` is the chip-friendly default; `md` for headers. */
  size?: 'sm' | 'md';
}

const SIZE_PX: Record<NonNullable<StatusDotProps['size']>, string> = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
};

// Color is paired with shape — both are part of the visual code.
const COLOR_BY_STATE: Record<string, string> = {
  live: 'text-emerald-400',
  paused: 'text-amber-400',
  offline: 'text-red-400',
  critical: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

/* Shapes — each one is a distinct silhouette inside an 8x8 viewBox so they
 * compose with the same SIZE_PX wrapper. Filled for "live"/"info"; the
 * paused glyph reads as a stop bar; offline is a hollow square (open state);
 * critical is a chevron-up (urgent); warning is a triangle. */

function FilledCircle() {
  return <circle cx="4" cy="4" r="3.25" fill="currentColor" />;
}

function PauseBars() {
  return (
    <g fill="currentColor">
      <rect x="1.5" y="1" width="1.6" height="6" rx="0.3" />
      <rect x="4.9" y="1" width="1.6" height="6" rx="0.3" />
    </g>
  );
}

function HollowSquare() {
  return (
    <rect
      x="1.25"
      y="1.25"
      width="5.5"
      height="5.5"
      rx="0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  );
}

function ChevronUp() {
  return (
    <path
      d="M1 5.5 L4 1.5 L7 5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function ExclamationTriangle() {
  return (
    <g fill="currentColor">
      <path d="M4 0.5 L7.6 7 L0.4 7 Z" />
      <rect x="3.55" y="2.6" width="0.9" height="2.4" fill="var(--background)" />
      <rect x="3.55" y="5.6" width="0.9" height="0.9" fill="var(--background)" />
    </g>
  );
}

function InfoCircle() {
  return (
    <g fill="currentColor">
      <circle cx="4" cy="4" r="3.25" />
      <rect x="3.55" y="3.2" width="0.9" height="2.4" fill="var(--background)" />
      <rect x="3.55" y="2" width="0.9" height="0.9" fill="var(--background)" />
    </g>
  );
}

const SHAPE: Record<string, () => React.JSX.Element> = {
  live: FilledCircle,
  paused: PauseBars,
  offline: HollowSquare,
  critical: ChevronUp,
  warning: ExclamationTriangle,
  info: InfoCircle,
};

export function StatusDot({
  kind,
  state,
  label,
  pulse = true,
  children,
  className = '',
  size = 'sm',
}: StatusDotProps) {
  const Shape = SHAPE[state];
  const color = COLOR_BY_STATE[state] ?? 'text-foreground';
  const showPulse = pulse && kind === 'connection' && state === 'live';

  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      role="img"
      aria-label={label}
    >
      <span className={`relative inline-flex flex-shrink-0 ${SIZE_PX[size]} ${color}`}>
        {showPulse && (
          <span
            aria-hidden="true"
            className="absolute inset-0 inline-flex animate-ping rounded-full opacity-60 bg-current"
          />
        )}
        <svg viewBox="0 0 8 8" className="relative w-full h-full" aria-hidden="true">
          {Shape ? <Shape /> : null}
        </svg>
      </span>
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}

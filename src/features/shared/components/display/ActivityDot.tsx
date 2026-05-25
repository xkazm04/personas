type ActivityTone = 'active' | 'pending' | 'idle' | 'off';

interface ActivityDotProps {
  /**
   * `active` — on and live (emerald glow). `pending` — partial/in-progress
   * (amber). `idle` — enabled but quiet (muted). `off` — inactive (faint).
   */
  tone: ActivityTone;
  /** `xs` (1.5) for dense inline rows, `sm` (2) for readiness lists. */
  size?: 'xs' | 'sm';
  className?: string;
}

const TONE_CLASS: Record<ActivityTone, string> = {
  active: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]',
  pending: 'bg-amber-400',
  idle: 'bg-foreground/25',
  off: 'bg-foreground/15',
};

/**
 * @catalog Decorative on/off activity dot (active glows emerald, pending amber, idle/off muted) for dense inline state hints.
 *
 * Purely decorative (`aria-hidden`): use when the adjacent label already
 * names the state. For semantic connection/severity state that must be
 * reported to assistive tech with a distinct shape silhouette, use the
 * heavier `StatusDot` instead — this is its lightweight counterpart.
 */
export function ActivityDot({ tone, size = 'sm', className = '' }: ActivityDotProps) {
  const dim = size === 'xs' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  return (
    <span
      aria-hidden
      className={`${dim} shrink-0 rounded-full ${TONE_CLASS[tone]} ${className}`.trim()}
    />
  );
}

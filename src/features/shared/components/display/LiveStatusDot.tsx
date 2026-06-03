export type LiveStatusTone = 'off' | 'active' | 'syncing';

export interface LiveStatusDotProps {
  /**
   * `off` — disabled/inactive (muted). `active` — on and live (emerald).
   * `syncing` — a pass is in flight (amber, pulsing). This is the single
   * liveness vocabulary shared across every cloud surface.
   */
  tone: LiveStatusTone;
  /**
   * Render an animated ping halo behind the dot, for "Live"-style indicators
   * that want extra emphasis (e.g. an auto-refreshing status header). Ignored
   * for the `off` tone. Defaults to false (a plain dot, as used in chips).
   */
  ping?: boolean;
  /** `xs` (1.5) for inline chips, `sm` (2) for section headers. */
  size?: 'xs' | 'sm';
  className?: string;
}

/** Solid fill (+ pulse on syncing) for the dot itself. */
const TONE_CLASS: Record<LiveStatusTone, string> = {
  off: 'bg-muted-foreground/40',
  active: 'bg-emerald-400',
  syncing: 'bg-amber-400 animate-pulse',
};

/** Halo color for the ping ring — same hue, no pulse (the ring animates). */
const PING_CLASS: Record<LiveStatusTone, string> = {
  off: '',
  active: 'bg-emerald-400',
  syncing: 'bg-amber-400',
};

/**
 * @catalog Liveness dot with one shared vocabulary (off=muted, active=emerald, syncing=amber-pulse) plus an optional ping halo — used across cloud sync/status surfaces.
 *
 * Purely decorative (`aria-hidden`): always pair it with an adjacent text
 * label that names the state (e.g. "Active", "Live", "Syncing…"). For
 * semantic connection/severity state that must be reported to assistive tech
 * with a distinct shape silhouette, use `StatusDot` instead.
 */
export function LiveStatusDot({ tone, ping = false, size = 'xs', className = '' }: LiveStatusDotProps) {
  const dim = size === 'xs' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  const showPing = ping && tone !== 'off';

  return (
    <span aria-hidden className={`relative inline-flex flex-shrink-0 ${dim} ${className}`.trim()}>
      {showPing && (
        <span className={`absolute inset-0 inline-flex animate-ping rounded-full opacity-75 ${PING_CLASS[tone]}`} />
      )}
      <span className={`relative inline-flex h-full w-full rounded-full ${TONE_CLASS[tone]}`} />
    </span>
  );
}

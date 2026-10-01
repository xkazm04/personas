import type { CSSProperties, ReactNode } from 'react';
import { LETTERING } from '@/features/studio/guide/drafting/draftingModel';

// Studio's drafting lettering (mono, upper case, spaced), borrowed for its
// voice only: LETTERING fixes a 12 px size, and this sheet keeps every word on
// the type ramp, so the size comes from `typo-label` (the ramp's floor) and the
// spacing and case from LETTERING.
export const LETTER_STYLE: CSSProperties = {
  letterSpacing: LETTERING.letterSpacing,
  textTransform: LETTERING.textTransform,
  fontFamily: 'var(--font-mono)',
};

export function Letter({
  children,
  strong = false,
  className = '',
}: {
  children: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span className={`typo-label ${className}`} style={{ ...LETTER_STYLE, color: strong ? 'var(--ink-strong)' : 'var(--ink)' }}>
      {children}
    </span>
  );
}

/**
 * A drawing's balloon: a numbered circle. Inked once there is something to
 * show; a dashed outline while the part is still pending.
 */
export function Balloon({ children, inked, size = 28 }: { children: ReactNode; inked: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="typo-label inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        ...LETTER_STYLE,
        letterSpacing: 0,
        width: size,
        height: size,
        border: `1px ${inked ? 'solid' : 'dashed'} ${inked ? 'var(--ink)' : 'var(--ink-dim)'}`,
        background: inked ? 'var(--ink)' : 'transparent',
        color: inked ? 'var(--paper)' : 'var(--ink-strong)',
      }}
    >
      {children}
    </span>
  );
}

/** "Not to scale": the drafting break mark on a line that runs past its scale. */
export function BreakMark({ height = 16 }: { height?: number }) {
  const h = height;
  return (
    <svg aria-hidden width={10} height={h} className="shrink-0 overflow-visible" data-break="true">
      <path
        d={`M5 0 L5 ${h * 0.3} L1 ${h * 0.45} L9 ${h * 0.6} L5 ${h * 0.72} L5 ${h}`}
        fill="none"
        stroke="var(--ink-strong)"
        strokeWidth={1.25}
      />
    </svg>
  );
}

/** The "not measured" patch: hatched, never an empty bar. */
export function Unmeasured({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden data-measured="false" className={`twd-hatch block ${className}`} style={style} />;
}

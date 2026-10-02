import type { CSSProperties, ReactNode } from 'react';
import { LETTERING } from '@/features/studio/guide/drafting/draftingModel';
import DrawFrame from './draw/DrawFrame';
import Write from './draw/Write';
import { isPaperless, useDraftingTheme } from './draftingTheme';

// Studio's drafting lettering (mono, upper case, spaced), borrowed for its
// voice only: LETTERING fixes a 12 px size, and this sheet keeps every word on
// the type ramp, so the size comes from `typo-label` (the ramp's floor) and the
// spacing and case from LETTERING.
export const LETTER_STYLE: CSSProperties = {
  letterSpacing: LETTERING.letterSpacing,
  textTransform: LETTERING.textTransform,
  fontFamily: 'var(--font-mono)',
};

/**
 * Drafting lettering; a plain string is lettered in when the sheet draws
 * itself. Where a theme inks onto the app's own surface (round 2 WP-C) the
 * same label speaks the app's type instead: an eyebrow, or a title when
 * `strong`, so a label and its figures meet on one type ramp.
 */
export function Letter({
  children,
  strong = false,
  className = '',
}: {
  children: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  const theme = useDraftingTheme();
  const text = typeof children === 'string' ? <Write text={children} /> : children;
  if (isPaperless(theme)) return <span className={`${strong ? 'typo-title' : 'typo-eyebrow twd-eyebrow'} ${className}`}>{text}</span>;
  return (
    <span className={`typo-label ${className}`} style={{ ...LETTER_STYLE, color: strong ? 'var(--ink-strong)' : 'var(--ink)' }}>
      {text}
    </span>
  );
}

/**
 * A drawing's balloon: a numbered circle, drawn as its container's content
 * (the circle, then, once inked, the ink filling it, then the number). Inked
 * once there is something to show; a dashed outline while the part is still
 * pending.
 */
export function Balloon({ number, inked, size = 28 }: { number: number; inked: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="typo-label relative inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        ...LETTER_STYLE,
        letterSpacing: 0,
        width: size,
        height: size,
        border: '1px solid transparent',
        color: inked ? 'var(--paper)' : 'var(--ink-strong)',
      }}
    >
      <DrawFrame shape="circle" kind="stroke" stroke={inked ? 'var(--ink)' : 'var(--ink-dim)'} dash={inked ? undefined : '3 2'} />
      {inked && <span data-draw="rise" className="absolute inset-0 rounded-full" style={{ background: 'var(--ink)' }} />}
      <span className="relative">
        <Write text={String(number)} />
      </span>
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
        pathLength={100}
        data-draw="stroke"
      />
    </svg>
  );
}

/** The "not measured" patch: hatched, never an empty bar; the hatch sweeps in. */
export function Unmeasured({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden data-measured="false" data-draw="sweep" className={`twd-hatch block ${className}`} style={style} />;
}

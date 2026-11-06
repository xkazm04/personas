import type { ReactNode } from 'react';

export type StateMarkState =
  | 'proposed' | 'decided' | 'running' | 'done' | 'waits' | 'skipped' | 'blank' | 'filler' | 'refused'
  | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'processing';

type GlyphKind =
  | 'dashed-ring' | 'square' | 'hatch' | 'check' | 'diamond' | 'diamond-outline' | 'dash'
  | 'struck-ring' | 'dotted-square' | 'dotted-ring' | 'ring';

interface StateSpec {
  glyph: GlyphKind;
  /** Signal colour of the glyph (a theme token class). */
  ink: string;
  /** Colour + weight of the word. */
  word: string;
}

const QUIET_WORD = 'text-ink-2';
const STRONG_WORD = 'text-ink-1';
const SOFT_WORD = 'text-ink-3';

/**
 * One glyph per state, drawn on a 12px grid in the signal colour; the word stays on the ink
 * ladder (decided alone takes the accent). The first nine are the Console decision states, the
 * last six are the generic StatusBadge vocabulary mapped onto the same glyph set.
 */
const SPEC: Record<StateMarkState, StateSpec> = {
  proposed:   { glyph: 'dashed-ring',     ink: 'text-status-warning',    word: QUIET_WORD },
  decided:    { glyph: 'square',          ink: 'text-primary',           word: 'text-primary font-semibold' },
  running:    { glyph: 'hatch',           ink: 'text-status-success',    word: STRONG_WORD },
  done:       { glyph: 'check',           ink: 'text-status-success',    word: SOFT_WORD },
  waits:      { glyph: 'diamond',         ink: 'text-status-error',      word: STRONG_WORD },
  skipped:    { glyph: 'dash',            ink: 'text-ink-3',             word: SOFT_WORD },
  blank:      { glyph: 'dotted-ring',     ink: 'text-ink-3',             word: SOFT_WORD },
  filler:     { glyph: 'dotted-square',   ink: 'text-ink-4',             word: SOFT_WORD },
  refused:    { glyph: 'struck-ring',     ink: 'text-ink-3',             word: SOFT_WORD },
  success:    { glyph: 'check',           ink: 'text-status-success',    word: QUIET_WORD },
  warning:    { glyph: 'diamond-outline', ink: 'text-status-warning',    word: QUIET_WORD },
  error:      { glyph: 'diamond',         ink: 'text-status-error',      word: QUIET_WORD },
  info:       { glyph: 'ring',            ink: 'text-status-info',       word: QUIET_WORD },
  neutral:    { glyph: 'dash',            ink: 'text-ink-3',             word: QUIET_WORD },
  processing: { glyph: 'hatch',           ink: 'text-status-processing', word: QUIET_WORD },
};

const RING = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;
const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

// The hatch is four diagonals clipped by hand to the bar, so it needs no <pattern>/<defs> on the page.
const HATCH = 'M0.75 5.75 L3.25 3.25 M1.25 8.75 L6.75 3.25 M4.75 8.75 L10.25 3.25 M8.25 8.75 L11.25 5.75';

function Shapes({ glyph }: { glyph: GlyphKind }) {
  switch (glyph) {
    case 'dashed-ring': return <circle cx="6" cy="6" r="4.25" {...RING} strokeDasharray="2.2 1.6" />;
    case 'ring': return <circle cx="6" cy="6" r="4.25" {...RING} />;
    case 'square': return <rect x="2" y="2" width="8" height="8" fill="currentColor" />;
    case 'hatch': return (
      <>
        <rect x="0.75" y="3.25" width="10.5" height="5.5" fill="none" stroke="currentColor" strokeWidth={1} />
        <path d={HATCH} fill="none" stroke="currentColor" strokeWidth={1} />
      </>
    );
    case 'check': return <polyline points="2.25,6.25 4.9,8.75 9.75,3.25" {...LINE} />;
    case 'diamond': return <rect x="2.6" y="2.6" width="6.8" height="6.8" transform="rotate(45 6 6)" fill="currentColor" />;
    case 'diamond-outline': return <rect x="2.6" y="2.6" width="6.8" height="6.8" transform="rotate(45 6 6)" {...RING} strokeWidth={1.4} />;
    case 'dash': return <line x1="2.5" y1="6" x2="9.5" y2="6" {...LINE} />;
    case 'dotted-ring': return <circle cx="6" cy="6" r="4.25" {...RING} strokeLinecap="round" strokeDasharray="0.1 2.2" />;
    case 'struck-ring': return (
      <>
        <circle cx="6" cy="6" r="4.25" {...RING} />
        <line x1="3" y1="9" x2="9" y2="3" {...LINE} />
      </>
    );
    case 'dotted-square': return (
      <>
        <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="1.5 1.5" />
        <path d="M4.5 4.5h0.01 M7.5 4.5h0.01 M4.5 7.5h0.01 M7.5 7.5h0.01" {...LINE} strokeWidth={1.2} />
      </>
    );
  }
}

export interface StateMarkProps {
  state: StateMarkState;
  /** The word beside the glyph. Omit for a glyph-only mark (give the row its own text then). */
  label?: ReactNode;
  size?: 'sm' | 'md';
  /** Placement only (margin, flex item behaviour). Appearance belongs to the state. */
  className?: string;
}

/**
 * StateMark: a state as a glyph in the signal colour and a word in mono ink. No pill, no fill, no motion.
 * @catalog StateMark - a state as glyph + mono word (15 states: proposed/decided/running/done/waits/skipped/blank/filler/refused plus success/warning/error/info/neutral/processing); replaces status pills.
 */
export function StateMark({ state, label, size = 'sm', className }: StateMarkProps) {
  const spec = SPEC[state];
  const hasLabel = label != null && label !== false && label !== '';
  return (
    <span
      data-state={state}
      className={['inline-flex min-w-0 max-w-full items-center overflow-hidden align-middle', size === 'md' ? 'gap-2' : 'gap-1.5', className].filter(Boolean).join(' ')}
    >
      <svg
        data-glyph={spec.glyph}
        viewBox="0 0 12 12"
        aria-hidden="true"
        className={`${size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} flex-none overflow-visible ${spec.ink}`}
      >
        <Shapes glyph={spec.glyph} />
      </svg>
      {hasLabel && (
        <span className={`typo-code ${spec.word} min-w-0 truncate whitespace-nowrap`}>{label}</span>
      )}
    </span>
  );
}

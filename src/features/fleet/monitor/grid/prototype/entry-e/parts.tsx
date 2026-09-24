// The three atoms every part of entry E is built from: the lamp, the segment
// strip (a quantity drawn as lamps) and the keycap. Nothing else on the panel
// invents its own way to say "on", "how much" or "press this".

import type { ReactNode } from 'react';
import { toneClass, type Lamp as LampModel, type Tone } from './tone';

export function Lamp({
  lamp, size = 'md', label, className = '',
}: { lamp: LampModel; size?: 'md' | 'lg'; label?: string; className?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`ae-lamp ${toneClass(lamp.tone)} ${lamp.lit ? 'is-lit' : ''} ${size === 'lg' ? 'is-lg' : ''} ${className}`}
    />
  );
}

/**
 * A quantity as a row of lamps: `lit` of `count` segments are on. `mark`
 * (0..count) draws a notch - the auto-rotate threshold, the linear pace.
 */
export function Segments({
  count, lit, tone, thin = false, mark = null, className = '',
}: {
  count: number;
  lit: number;
  tone: Tone;
  thin?: boolean;
  mark?: number | null;
  className?: string;
}) {
  const on = Math.max(0, Math.min(count, Math.round(lit)));
  return (
    <span className={`relative block ${className}`} aria-hidden>
      <span className={`ae-segs ${thin ? 'is-thin' : ''} ${toneClass(tone)}`}>
        {Array.from({ length: count }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}
      </span>
      {mark !== null && (
        <span
          className="absolute -bottom-1 -top-1 w-px bg-foreground/70"
          style={{ left: `${(Math.max(0, Math.min(count, mark)) / count) * 100}%` }}
        />
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ae-kbd typo-code">{children}</kbd>;
}

/** An engraved plate title: the small caps line a section opens with. */
export function Engraved({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`ae-engrave typo-label ${className}`}>{children}</span>;
}

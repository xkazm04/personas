/** A persona / source as a square monogram seal, ringed in its own colour; the name lives in a tooltip. */
import type { CSSProperties } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

export function initialOf(label: string): string {
  // By codepoint, not code unit: an emoji-initial name must not split a surrogate pair.
  return ([...label][0] ?? '?').toUpperCase();
}

export function Mono({ label, color, size = 'sm', tip = false }: {
  label: string;
  color?: string | null;
  size?: 'sm' | 'lg';
  /** Wrap in a tooltip naming the source (when the name is not printed beside it). */
  tip?: boolean;
}) {
  const seal = (
    <span
      className="r2b-mono"
      data-size={size}
      style={color ? ({ '--r2b-mono-ring': color } as CSSProperties) : undefined}
      aria-hidden={!tip}
      aria-label={tip ? label : undefined}
    >
      {initialOf(label)}
    </span>
  );
  return tip ? <Tooltip content={label}>{seal}</Tooltip> : seal;
}

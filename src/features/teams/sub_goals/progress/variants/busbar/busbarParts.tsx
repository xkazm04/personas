/**
 * The small drawn parts Busbar is made of: the hex terminal, the keycap, the
 * twenty-cell meter and the drafting-sheet corner brackets. Figures, not
 * chrome (doctrine 6c): tokenised ink, free geometry.
 */
import type { CSSProperties, ReactNode } from 'react';

/** Flat-sided hexagon in a 24 x 27 box - the winner's terminal shape. */
const HEX_POINTS = '12,1.5 22.5,7.5 22.5,19.5 12,25.5 1.5,19.5 1.5,7.5';

/**
 * A hex terminal. `ink` strokes it; `fill` (0-1) tints its face with the same
 * ink; `dashed` is the open bus. The label sits centred on top.
 */
export function Hex({
  ink,
  size = 24,
  fill = 0,
  dashed = false,
  children,
  className = '',
}: {
  ink: string;
  size?: number;
  fill?: number;
  dashed?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const h = Math.round((size * 27) / 24);
  // A colour-mix weight, not a display number.
  const tint = Math.round(fill * 100);
  return (
    <span className={`bb-hex ${className}`} style={{ width: size, height: h, '--hx': ink } as CSSProperties}>
      <svg viewBox="0 0 24 27" aria-hidden="true">
        <polygon
          points={HEX_POINTS}
          fill={fill > 0 ? `color-mix(in srgb, ${ink} ${tint}%, transparent)` : 'var(--background)'}
          stroke={ink}
          strokeWidth={1.6}
          strokeDasharray={dashed ? '3 2.4' : undefined}
        />
      </svg>
      {children !== undefined && <span className="bb-hex-label typo-code">{children}</span>}
    </span>
  );
}

/** A key as it is pressed. Monospace via the app's code token. */
export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="bb-kc typo-code">{children}</kbd>;
}

/** Twenty cells, lit to the goal's percentage; a half-lit cell for the remainder. */
export function Meter({ pct }: { pct: number }) {
  const lit = pct / 5;
  return (
    <span className="bb-meter" aria-hidden="true">
      {Array.from({ length: 20 }, (_, i) => (
        <i key={i} className={i < Math.floor(lit) ? 'on' : i < lit ? 'half' : undefined} />
      ))}
    </span>
  );
}

/** Registration brackets on the four corners of a drafting sheet. */
export function CornerBrackets() {
  return (
    <>
      <span className="bb-cb tl" aria-hidden="true" />
      <span className="bb-cb tr" aria-hidden="true" />
      <span className="bb-cb bl" aria-hidden="true" />
      <span className="bb-cb br" aria-hidden="true" />
    </>
  );
}

/** Short day for a FIN / DUE stamp in the ACTIVE UI language (not the host
 *  machine's), or `null` when the goal has no date. */
export function shortDay(iso: string | null, language: string): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString(language, { month: 'short', day: 'numeric' });
}

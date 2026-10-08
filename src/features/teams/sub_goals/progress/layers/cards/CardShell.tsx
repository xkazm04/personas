/**
 * The one pressable card surface of the CARDS prototype, and the perimeter
 * gauge that makes a milestone card its own progress meter.
 *
 * A selectable card is the case `raw-button-element` names as legitimate (no
 * shared primitive is a whole-card press target), so it is written ONCE here
 * and every card kind - milestone, unassigned, add, sticky note - reuses it.
 */
import type { ReactNode } from 'react';

import { perimeterDash } from './cardsModel';

interface CardShellProps {
  onPress: () => void;
  /** Only when the visible content does not already name the card. */
  ariaLabel?: string;
  testId: string;
  className: string;
  disabled?: boolean;
  children: ReactNode;
}

export function CardShell({ onPress, ariaLabel, testId, className, disabled, children }: CardShellProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`relative w-full text-left focus-ring transition-[box-shadow,background-color,transform] duration-200 motion-reduce:transition-none ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * The card's border as a gauge: a rounded `rect` the size of the card with
 * `pathLength=100`, so the dash IS the percent and it runs clockwise from the
 * top-left corner. A faint full track sits under it. `null` progress (no goals
 * bound) draws a dashed, unfilled outline - an empty cut has no fill to claim.
 *
 * Colour comes in as `currentColor` from the milestone tone's text class.
 */
export function PerimeterGauge({ progress, toneText }: { progress: number | null; toneText: string }) {
  const dash = perimeterDash(progress);
  // The svg sits 1.5px inside the card so the 3px stroke, centred on the
  // rect's edge, lands exactly on the card's own border line.
  const rect = { x: 0, y: 0, width: '100%', height: '100%', style: { rx: 'var(--radius-card)' } } as const;
  return (
    <svg aria-hidden className={`pointer-events-none absolute inset-[1.5px] overflow-visible ${toneText}`}>
      {dash === null ? (
        <rect {...rect} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="6 5" />
      ) : (
        <>
          <rect {...rect} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={3} />
          <rect
            {...rect}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            pathLength={100}
            strokeDasharray={dash}
            strokeLinecap={progress ? 'round' : 'butt'}
            className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
          />
        </>
      )}
    </svg>
  );
}

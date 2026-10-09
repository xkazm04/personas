/**
 * The one pressable card surface of the Notes view (the project rail's entries).
 *
 * A selectable card is the case `raw-button-element` names as legitimate (the
 * shared `Button` has no class merge, so it cannot be a whole-card press
 * target), so it is written ONCE here - the +1 that rule's baseline carries.
 */
import type { ReactNode } from 'react';

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

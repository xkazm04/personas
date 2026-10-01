import type { KeyboardEvent, ReactNode } from 'react';

/**
 * A drawn row that opens its full detail: the whole row is the target (a
 * pointer anywhere on the drawing, Enter or Space from the keyboard), with
 * the sheet's hover wash and the app's focus ring. Used where a row holds a
 * small drawing, which a button's phrasing-only content cannot carry.
 */
export default function PressRow({
  label,
  onPress,
  className = '',
  children,
}: {
  /** The accessible name: what pressing opens. */
  label: string;
  onPress: () => void;
  className?: string;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onPress();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onPress}
      onKeyDown={onKeyDown}
      className={`twd-region focus-ring rounded-interactive ${className}`}
    >
      {children}
    </div>
  );
}

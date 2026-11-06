/** ChoicePill - a one-click choice in a quick setup (a preset, a day, an
 *  event kind). Pressed pills take the dimension's colour. */
import type { ReactNode } from "react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import Button from '@/features/shared/components/buttons/Button';

interface ChoicePillProps {
  on: boolean;
  color: string;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

export function ChoicePill({ on, color, onClick, children, ariaLabel }: ChoicePillProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={ariaLabel}
      style={on ? { borderColor: colorWithAlpha(color, 0.6), background: colorWithAlpha(color, 0.14) } : undefined}
      variant={on ? 'secondary' : 'ghost'}
      size="sm"
    >{children}</Button>
  );
}

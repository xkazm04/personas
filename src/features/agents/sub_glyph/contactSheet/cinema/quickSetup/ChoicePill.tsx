/** ChoicePill - a one-click choice in a quick setup (a preset, a day, an
 *  event kind). Pressed pills take the dimension's colour. */
import type { ReactNode } from "react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";

interface ChoicePillProps {
  on: boolean;
  color: string;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

export function ChoicePill({ on, color, onClick, children, ariaLabel }: ChoicePillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border typo-body text-foreground transition-colors ${
        on ? "" : "border-card-border hover:bg-secondary/40"
      }`}
      style={on ? { borderColor: colorWithAlpha(color, 0.6), background: colorWithAlpha(color, 0.14) } : undefined}
    >
      {children}
    </button>
  );
}

// DispatchMethodCards — the chooser's transports as a radio group of icon cards.
//
// Extracted from `DispatchChooser` when the "Run on" picker arrived: a card can
// now be DISABLED with a reason (the runner and the console exist only on this
// machine), and the reason replaces the card's description, so the operator
// reads why a card is off exactly where they would have clicked it.

import { Bot, SquareTerminal, TerminalSquare, Zap } from 'lucide-react';
import type { DispatchMethod } from './DispatchChooser';

const METHOD_ICON: Record<DispatchMethod, typeof Bot> = {
  dev_runner: Bot,
  fleet: SquareTerminal,
  cli: Zap,
  console: TerminalSquare,
};

export function DispatchMethodCards({ methods, value, onChange, meta, disabledReason, ariaLabel }: {
  methods: DispatchMethod[];
  value: DispatchMethod;
  onChange: (m: DispatchMethod) => void;
  meta: Record<DispatchMethod, { label: string; desc: string }>;
  /** Why a method cannot be picked right now, or `null` when it can. */
  disabledReason: (m: DispatchMethod) => string | null;
  ariaLabel: string;
}) {
  return (
    <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={ariaLabel}>
      {methods.map((m) => {
        const Icon = METHOD_ICON[m];
        const reason = disabledReason(m);
        const on = value === m && reason === null;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={reason !== null || undefined}
            disabled={reason !== null}
            onClick={() => onChange(m)}
            className={`rounded-card border px-3 py-2.5 text-left transition-colors focus-ring ${
              reason !== null
                ? 'cursor-not-allowed border-foreground/[0.06] opacity-50'
                : on ? 'border-primary/50 bg-primary/[0.07]' : 'border-foreground/[0.1] hover:bg-foreground/[0.03]'
            }`}
            data-testid={`dispatch-method-${m}`}
          >
            <span className="flex items-center gap-1.5 mb-1">
              <Icon className={`w-4 h-4 ${on ? 'text-primary' : 'text-foreground'}`} aria-hidden />
              <span className={on ? 'typo-title' : 'typo-caption text-foreground'}>{meta[m].label}</span>
            </span>
            <span className="typo-caption block leading-snug">{reason ?? meta[m].desc}</span>
          </button>
        );
      })}
    </div>
  );
}

export default DispatchMethodCards;

/**
 * Four suit cards across the top, one per slot. Suit identity is shape (icon);
 * the ONLY colour that varies here is the `StatusGlyph`, so green on this strip
 * always means "set" and never "channels". Clicking a card moves the guided
 * flow to that slot.
 */

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { StatusGlyph } from '../../setup/SetupReadinessRow';
import type { SetupChecklistItem, SetupFocus } from '../../setup/setupContract';
import { SUITS } from '../suits';

interface TableProgressProps {
  checklist: SetupChecklistItem[];
  score: number;
  focus: SetupFocus;
  onFocus: (focus: SetupFocus) => void;
}

export function TableProgress({ checklist, score, focus, onFocus }: TableProgressProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  return (
    <div
      className="flex-shrink-0 flex items-stretch gap-2 px-4 md:px-6 py-2"
      data-testid="setup-readiness-strip"
      role="group"
      aria-label={tx.table.score}
    >
      {checklist.map((item) => {
        const suit = SUITS[item.id];
        const Icon = suit.Icon;
        const active = item.id === focus;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onFocus(item.id)}
            aria-current={active ? 'step' : undefined}
            data-testid={`setup-readiness-${item.id}`}
            className={`focus-ring flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-card border transition-colors ${
              active ? `${suit.borderPicked} ${suit.wash}` : `${suit.border} bg-card-bg/60 hover:bg-secondary/40`
            }`}
          >
            <StatusGlyph status={item.status} />
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${suit.pip}`} aria-hidden />
            <span className="min-w-0 flex items-baseline gap-2">
              <span className="typo-caption truncate text-foreground">
                {tx.slots[item.id].label}
              </span>
              <span className="typo-caption tabular-nums">{item.detail}</span>
            </span>
          </button>
        );
      })}
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-card border border-primary/25 bg-primary/10"
        data-testid="setup-readiness-score"
      >
        <span className="typo-caption">{tx.table.score}</span>
        <Numeric value={clamped} unit="percent" precision={0} className="typo-data text-foreground" />
      </div>
    </div>
  );
}

export default TableProgress;

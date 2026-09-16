/**
 * DeskTurn — the guide SPEAKING, rather than a prompt appearing.
 *
 * The question is rendered as a conversation turn: the guide's mark on the
 * left, and on the right an opening line (only on the first turn of a session,
 * where it names what the walk-through will cover), the slot being worked, the
 * question itself, and the offered answers as equal-height cards a digit key
 * picks.
 *
 * While a turn is in flight the question is replaced by a calm ghost, never a
 * spinner (loading pattern v2): a surface fetching its next question is a
 * surface, not a pressed control.
 */

import { Wand2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupSuggestion } from '../setupContract';

interface DeskTurnProps {
  /** Localized name of the slot this question belongs to. */
  focusLabel: string;
  /** Opening line, set only on the first turn of a session. */
  greeting: string | null;
  question: string;
  cards: SetupSuggestion[];
  picked: number;
  busy: boolean;
  onPick: (index: number) => void;
  onCommit: (text: string) => void;
}

export function DeskTurn({
  focusLabel,
  greeting,
  question,
  cards,
  picked,
  busy,
  onPick,
  onCommit,
}: DeskTurnProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;

  return (
    <div className="flex gap-3" data-testid="setup-desk-turn">
      <span
        aria-hidden
        className="mt-1 w-8 h-8 flex-shrink-0 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center"
      >
        <Wand2 className="w-4 h-4 text-primary" />
      </span>

      <div className="min-w-0 flex-1">
        {busy ? (
          <>
            <span aria-hidden className="block h-4 w-40 rounded-full bg-secondary/50" />
            <span aria-hidden className="mt-3 block h-7 w-2/3 rounded-card bg-secondary/40" />
            <span className="sr-only" role="status">{ts.desk.thinking}</span>
          </>
        ) : (
          <>
            {greeting && (
              <p className="typo-body text-foreground leading-relaxed" data-testid="setup-desk-greeting">
                {greeting}
              </p>
            )}
            <p className={`typo-caption uppercase tracking-[0.2em] text-primary/70 ${greeting ? 'mt-3' : ''}`}>
              {focusLabel}
            </p>
            <h2 className="mt-1 typo-heading text-foreground" data-testid="setup-desk-question">
              {question}
            </h2>

            {cards.length > 0 && (
              <div
                className="mt-5 grid gap-3"
                style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}
              >
                {cards.map((card, i) => (
                  <button
                    key={card.text}
                    type="button"
                    onClick={() => onPick(i)}
                    onDoubleClick={() => onCommit(card.text)}
                    aria-pressed={i === picked}
                    data-testid={`setup-desk-suggestion-${i + 1}`}
                    className={`h-full flex flex-col gap-2 p-3 rounded-card border text-left transition-all ${
                      i === picked
                        ? 'border-primary/45 bg-primary/10 shadow-elevation-2'
                        : 'border-primary/15 bg-card/50 hover:border-primary/30'
                    }`}
                  >
                    <span className="typo-caption tabular-nums">{i + 1}</span>
                    <span className="typo-body text-foreground leading-relaxed">{card.text}</span>
                    <span className="mt-auto typo-caption">{card.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default DeskTurn;

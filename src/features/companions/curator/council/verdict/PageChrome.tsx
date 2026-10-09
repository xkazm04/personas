// The verdict page's furniture: the way back (a visible control and Esc),
// the rounds selector, and the two states a round can be in before it is
// readable.
import { useCallback } from 'react';
import { ArrowLeft, RotateCw } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import type { CouncilRunView } from '../table/useCouncilRun';

/** Esc returns to the galaxy, unless the reader is typing (a rejection reason). */
export function useEscBack(onBack: () => void) {
  useAppKeyboard(
    useCallback(
      (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || isTypingTarget(e.target)) return false;
        onBack();
        return true;
      },
      [onBack],
    ),
    { priority: ROUTE_DECISION_PRIORITY + 5 },
  );
}

export function BackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const w = t.council.verdict;
  return (
    <Button
      variant="ghost"
      size="md"
      icon={<ArrowLeft className="h-5 w-5" />}
      onClick={onBack}
      aria-label={w.back_label}
      data-testid="council-page-back"
    >
      {w.back}
    </Button>
  );
}

/**
 * Shown only when the chain holds more than one round. A pressed-button group,
 * not a tab strip: it swaps which round the whole page reads, it does not
 * select among panels of its own.
 */
export function RoundPicker({ run }: { run: CouncilRunView }) {
  const { t, tx } = useTranslation();
  const w = t.council.verdict;
  if (run.chain.length < 2 || !run.detail) return null;
  const shown = run.detail.run.id;
  return (
    <div role="group" aria-label={w.rounds} className="inline-flex items-center gap-1 rounded-card border border-border p-1">
      {run.chain.map((d) => {
        const on = d.run.id === shown;
        return (
          <Button
            key={d.run.id}
            variant={on ? 'accent' : 'ghost'}
            tone={on ? 'highlight' : undefined}
            size="sm"
            aria-pressed={on}
            onClick={() => run.showRound(d.run.id)}
            data-testid={`council-page-round-${d.run.roundNo}`}
          >
            {tx(d.run.mode === 'lite' ? w.round_lite : w.round, { n: d.run.roundNo })}
          </Button>
        );
      })}
    </div>
  );
}

/** A failed read is an inline sentence with a retry, never an empty card. */
export function ReadFailed({ run }: { run: CouncilRunView }) {
  const { t } = useTranslation();
  const w = t.council.verdict;
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border border-status-error/40 bg-status-error/5 p-6">
      <p className="m-0 typo-body-lg text-foreground">{w.read_failed}</p>
      <Button variant="secondary" size="md" icon={<RotateCw className="h-4 w-4" />} onClick={run.reload}>
        {w.retry}
      </Button>
    </div>
  );
}

/** A calm ghost block, drawn under the page's own chrome while the round is read. */
export function Ghost({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse motion-reduce:animate-none rounded-card bg-foreground/[0.06] ${className}`}
    />
  );
}

/**
 * One line naming what the last Director batch did: how many personas it
 * evaluated, how many verdicts that produced, and who it skipped and why.
 *
 * The backend has always returned those counts (`DirectorReport`); the tab
 * discarded them, so a freshness-skipped cycle and a full coaching cycle
 * looked identical from the outside. See `batchOutcome.ts`.
 */
import { CheckCircle2, MinusCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { cappedSkippedNames, type BatchOutcome } from '../batchOutcome';

interface BatchOutcomeLineProps {
  outcome: BatchOutcome;
}

export function BatchOutcomeLine({ outcome }: BatchOutcomeLineProps) {
  const { t, tx } = useTranslation();
  const { shown, more } = cappedSkippedNames(outcome.skippedUnchangedNames);

  const parts: string[] = [];
  if (outcome.skippedUnchanged > 0) {
    const names = shown.join(', ');
    parts.push(
      tx(t.director.batch_outcome_skipped_unchanged, {
        count: outcome.skippedUnchanged,
        names: more > 0 ? `${names} (${tx(t.director.batch_outcome_skipped_more, { count: more })})` : names,
      }),
    );
  }
  if (outcome.skippedNoRuns > 0) {
    parts.push(tx(t.director.batch_outcome_skipped_no_runs, { count: outcome.skippedNoRuns }));
  }

  const reviewed = outcome.kind === 'reviewed';
  const Icon = reviewed ? CheckCircle2 : MinusCircle;

  return (
    <span
      className="inline-flex items-center gap-1.5 min-w-0"
      data-testid="director-batch-outcome"
    >
      <Icon
        className={`w-3.5 h-3.5 shrink-0 ${reviewed ? 'text-violet-300' : 'text-foreground'}`}
        aria-hidden
      />
      <span className="truncate text-foreground">
        {reviewed
          ? tx(t.director.batch_outcome_reviewed, {
              evaluated: outcome.evaluated,
              verdicts: outcome.verdicts,
            })
          : t.director.batch_outcome_nothing}
        {parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}
      </span>
    </span>
  );
}

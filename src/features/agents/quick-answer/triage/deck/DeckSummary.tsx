// DeckSummary — what the session actually was, at the moment it ends.
//
// The cleared state already congratulated the reviewer with a count. A count is
// not a session: forty cards cleared in four minutes with a 4% accept rate is a
// completely different afternoon from forty cleared in forty with an 80% one,
// and until now the deck could not tell them apart because it recorded nothing.
//
// Three deliberate restraints:
//
//  1. **Only what happened.** No targets, no trend, no "you're 12% faster than
//     last week" — the journal could support that and it would turn a triage
//     surface into a performance dashboard, which is how reviewers start
//     optimising the number instead of the queue.
//  2. **Deferrals and lost swaps are shown, not hidden.** They are the two
//     things a throughput count would flatter away: "I could not judge this"
//     is real work, and a verdict that lost a compare-and-swap is effort the
//     reviewer spent and did not get.
//  3. **Median, not mean, for pace.** One card left open while its run was read
//     would drag a mean past uselessness.
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';

import type { TriageSessionSummary } from '../triageJournal';
import { kindCopy, KIND_META, TONE_TEXT } from './DeckChips';

/** One figure and its name. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  return (
    <div className="min-w-16 text-center">
      <p
        className={`typo-data-lg tabular-nums ${
          tone === 'success'
            ? TONE_TEXT.success
            : tone === 'warning'
              ? TONE_TEXT.warning
              : 'text-foreground'
        }`}
      >
        {typeof value === 'number' ? <Numeric value={value} /> : value}
      </p>
      <p className="typo-label uppercase tracking-wide text-foreground">{label}</p>
    </div>
  );
}

export function DeckSummary({ summary }: { summary: TriageSessionSummary }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;

  // Nothing decided and nothing deferred means there is no session to describe;
  // the cleared state's own headline already says everything true.
  if (summary.decided === 0 && summary.skipped === 0) return null;

  const acceptRate =
    summary.decided > 0 ? Math.round((summary.accepted / summary.decided) * 100) : null;
  const paceSeconds =
    summary.medianDwellMs != null ? Math.max(1, Math.round(summary.medianDwellMs / 1000)) : null;

  return (
    <section
      className="w-full rounded-card border border-primary/12 bg-secondary/25 p-4"
      aria-label={m.triage_summary_title}
    >
      <h3 className="typo-label mb-3 uppercase tracking-wide text-primary">
        {m.triage_summary_title}
      </h3>

      <div className="flex flex-wrap items-start justify-center gap-x-6 gap-y-3">
        <Stat label={m.triage_summary_decided} value={summary.decided} />
        {acceptRate != null ? (
          <Stat
            label={m.triage_summary_accepted}
            value={tx(m.triage_summary_rate, { percent: acceptRate })}
            tone="success"
          />
        ) : null}
        {summary.skipped > 0 ? (
          <Stat label={m.triage_summary_deferred} value={summary.skipped} />
        ) : null}
        {paceSeconds != null ? (
          <Stat
            label={m.triage_summary_pace}
            value={tx(m.triage_summary_pace_value, { seconds: paceSeconds })}
          />
        ) : null}
        {summary.undone > 0 ? (
          <Stat label={m.triage_summary_undone} value={summary.undone} />
        ) : null}
        {summary.conflicts > 0 ? (
          <Stat label={m.triage_summary_lost} value={summary.conflicts} tone="warning" />
        ) : null}
      </div>

      {summary.byKind.length > 0 ? (
        <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-primary/10 pt-3">
          {summary.byKind.map((tally) => {
            const Icon = KIND_META[tally.kind].icon;
            return (
              <li key={tally.kind} className="inline-flex items-center gap-1.5 typo-caption text-foreground">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${TONE_TEXT[KIND_META[tally.kind].tone]}`} aria-hidden />
                <span>{kindCopy(t, tally.kind).label}</span>
                <span className="typo-data tabular-nums">
                  {tx(m.triage_summary_kind_value, {
                    accepted: tally.accepted,
                    decided: tally.decided,
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

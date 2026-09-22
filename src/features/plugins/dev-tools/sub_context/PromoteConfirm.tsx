// "Promote to major" asks first, and says what it will do.
//
// The tier is an INPUT to the derived council state, not a stored verdict, and
// `derive_council_state` recomputes on every read. So flipping one word turns
// `machine_pass` into `ready`, opens the gate, moves the subject out of "done"
// into the pending bucket, raises the headline decidable count, swaps the
// gate's copy - and puts the EXISTING verdict in front of a human as a live
// decision. On the real kp run that verdict was an uncalibrated 0.6289 at 90%
// coverage. Every one of those consequences followed from a control that
// fired on the first click and said nothing.
//
// It is a confirmation, not a new decision: the numbers in the sentence are
// the ones already stored, and the dialog never re-scores anything.
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';

import type { TDevTools } from './contextLedgerShared';

export interface PromoteSubjectFacts {
  name: string;
  /** Null is "not measured" - never rendered as 0.00. */
  overall: number | null;
  coverage: number | null;
  trustState: string | null;
}

export function PromoteConfirm({
  facts,
  t,
  percent,
  tx,
  onConfirm,
  onCancel,
}: {
  facts: PromoteSubjectFacts;
  t: TDevTools;
  percent: (ratio: number) => string;
  tx: (template: string, vars: Record<string, string | number>) => string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const trust =
    facts.trustState === 'trusted'
      ? t.council_trust_trusted
      : facts.trustState === 'untrusted'
        ? t.council_trust_untrusted
        : facts.trustState === 'uncalibrated'
          ? t.council_trust_uncalibrated
          : t.council_trust_unknown;

  return (
    <ConfirmDialog
      title={t.council_promote_title}
      body={tx(t.council_promote_body, {
        name: facts.name,
        overall: facts.overall == null ? t.council_promote_no_overall : facts.overall.toFixed(2),
        coverage: facts.coverage == null ? t.council_promote_no_overall : percent(facts.coverage),
        trust,
      })}
      confirmLabel={t.council_promote_confirm}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export default PromoteConfirm;

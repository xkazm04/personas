// "Athena marked N things on this board" — and the one control that takes those
// marks back off. Deliberately a single undifferentiated revert rather than a
// per-object menu: the user's mental model of a second writer is "hers" vs
// "mine", and the promise that matters is that removing hers cannot touch his.
//
// Scope is CANVAS ANNOTATIONS only (groups / links / notes). Composed project
// panels are a different scope with their own per-project reset — sweeping them
// from a control labelled "remove her marks" would mean tidying two sticky
// notes silently wipes composed panels across every project.
// Sits with the other global canvas controls, just above the zoom cluster.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';

export function AthenaRevertControl({ count, onRevert }: {
  /** How many Athena-authored ANNOTATIONS are on the board. 0 hides the control. */
  count: number;
  onRevert: () => void;
}) {
  const { t, tx } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (count <= 0) return null;
  const label = tx(count === 1 ? t.mastermind.athena_revert_one : t.mastermind.athena_revert_other, { count });
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={label}
        title={label}
        className="absolute bottom-14 right-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive bg-secondary/70 border border-accent/40 text-accent shadow-elevation-2 backdrop-blur-sm hover:bg-accent/10 transition-colors focus-ring"
        data-testid="mm-athena-revert"
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden />
        <span className="typo-caption font-semibold tabular-nums">{count}</span>
      </button>
      {confirming && (
        <ConfirmDialog
          title={t.mastermind.athena_revert_title}
          body={tx(count === 1 ? t.mastermind.athena_revert_body_one : t.mastermind.athena_revert_body_other, { count })}
          danger
          confirmLabel={t.mastermind.athena_revert_cta}
          onConfirm={() => { onRevert(); setConfirming(false); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

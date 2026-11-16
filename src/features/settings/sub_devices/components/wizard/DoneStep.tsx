/**
 * Done: how the pairing ended, in plain words, and the one way out.
 * `declined` covers "the other side said no" AND "it ran out": the initiator
 * cannot tell them apart, so the copy does not pretend to.
 */
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { DoneKind } from '../../lib/wizardStep';

export function DoneStep({ kind, displayName, onBack }: { kind: DoneKind; displayName: string; onBack: () => void }) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const device = displayName;
  const copy: Record<DoneKind, { title: string; body: string }> = {
    paired: { title: tx(st.wizard_done_paired_title, { device }), body: st.wizard_done_paired_body },
    declined: { title: tx(st.wizard_done_declined_title, { device }), body: st.wizard_done_declined_body },
    wrongCode: { title: st.wizard_done_wrong_code_title, body: tx(st.wizard_done_wrong_code_body, { device }) },
  };
  const ok = kind === 'paired';

  return (
    <div data-testid="wizard-done" data-done-kind={kind} className="space-y-4 text-center">
      {ok ? (
        <CheckCircle2 className="w-12 h-12 mx-auto text-status-success" aria-hidden />
      ) : (
        <XCircle className="w-12 h-12 mx-auto text-status-error" aria-hidden />
      )}
      <div className="space-y-1" role="status">
        <h3 className="typo-heading text-foreground">{copy[kind].title}</h3>
        <p className="typo-body text-foreground">{copy[kind].body}</p>
      </div>
      <Button block data-testid="wizard-done-back" onClick={onBack}>
        {st.wizard_done_back}
      </Button>
    </div>
  );
}

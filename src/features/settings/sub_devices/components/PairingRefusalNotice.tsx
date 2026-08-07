/**
 * Renders a REFUSED pairing as an explanation plus a fix, not as a generic
 * failure toast. Each refusal code the backend can produce has a concrete next
 * action (reconnect, unpair on the other side, confirm on the other screen);
 * burying that behind "Pairing failed" is what strands the operator.
 */
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PairingRefusalCode } from '../lib/pairingRefusal';
import type { PairingOutcome } from '../lib/pairingMachine';

interface PairingRefusalNoticeProps {
  outcome: Extract<PairingOutcome, { kind: 'refused' }>;
  onDismiss: () => void;
}

export function PairingRefusalNotice({ outcome, onDismiss }: PairingRefusalNoticeProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;

  const COPY: Record<PairingRefusalCode, { title: string; fix: string }> = {
    group_conflict: { title: st.refusal_group_conflict, fix: st.refusal_group_conflict_fix },
    not_connected: { title: st.refusal_not_connected, fix: st.refusal_not_connected_fix },
    self_pair: { title: st.refusal_self_pair, fix: st.refusal_self_pair_fix },
    declined: { title: st.refusal_declined, fix: st.refusal_declined_fix },
    too_many_pending: { title: st.refusal_too_many_pending, fix: st.refusal_too_many_pending_fix },
    timed_out: { title: st.refusal_timed_out, fix: st.refusal_timed_out_fix },
    no_longer_pending: { title: st.refusal_no_longer_pending, fix: st.refusal_no_longer_pending_fix },
    wrong_side: { title: st.refusal_wrong_side, fix: st.refusal_wrong_side_fix },
    unauthorized: { title: st.refusal_unauthorized, fix: st.refusal_unauthorized_fix },
    unavailable: { title: st.refusal_unavailable, fix: st.refusal_unavailable_fix },
    unknown: { title: st.refusal_unknown, fix: st.refusal_unknown_fix },
  };

  const copy = COPY[outcome.refusal.code];

  return (
    <div
      data-testid="pairing-refusal"
      data-refusal-code={outcome.refusal.code}
      role="alert"
      className="flex items-start gap-3 rounded-modal border border-amber-500/30 bg-amber-500/10 p-3"
    >
      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="typo-body font-medium text-foreground">
          {tx(st.refusal_title, { device: outcome.displayName })}
        </p>
        <p className="typo-caption text-foreground">{copy.title}</p>
        <p className="typo-caption text-foreground/90">{copy.fix}</p>
        {/* The backend's own words, kept for the codes we could not classify. */}
        {outcome.refusal.code === 'unknown' && outcome.refusal.detail && (
          <p data-testid="pairing-refusal-detail" className="typo-code text-foreground/90 break-words">
            {outcome.refusal.detail}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        data-testid="pairing-refusal-dismiss"
        aria-label={st.refusal_dismiss}
        title={st.refusal_dismiss}
        className="p-1 rounded-card hover:bg-secondary/50 text-foreground flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

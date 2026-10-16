import { memo, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Branch, Verdict } from '@/features/decision-center/deck/DeckDock';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import { dispatchReviewRowAction, resolveReviewRow } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';
import { Engraved, Lamp } from '../grid/prototype/entry-e/parts';
import { AskHead } from './AskHead';
import { reviewStatusOf } from './personaConversationModel';

/* ----------------------------------------------------------------------------
 * PERSONA REVIEW CARD - a review in a persona's channel, in the deck's anatomy
 * (WP12). Pending: the card head with the outcome pair, the verdict pair (no
 * key printed here: the keys act on the Needs you rail, which lists the same
 * review), each suggested action as a branch that resolves AND dispatches the
 * follow-up run, and Open in Reviews. Decided: it stays in place as its record,
 * one line with the verdict. No raw coloured buttons.
 * -------------------------------------------------------------------------- */

export const PersonaReviewCard = memo(function PersonaReviewCard({ item, onResolved }: {
  item: PersonaChannelItem;
  /** Fired after a verdict lands: the caller refreshes the channel so the card re-renders as its record. */
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const status = reviewStatusOf(item);
  const actions = parseSuggestedActions(item.suggestedActions);
  const [busy, setBusy] = useState(false);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const row = { id: item.reviewId ?? '', execution_id: item.executionId ?? '', source: 'local' as const };

  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    fn().then(onResolved).catch(toastCatch('personaChannel:review')).finally(() => setBusy(false));
  };
  const openInReviews = () => {
    setOverviewTab('manual-review');
    setSidebarSection('overview');
  };
  const open = (
    <Button variant="ghost" size="xs" icon={<ExternalLink className="h-3 w-3" aria-hidden />} onClick={openInReviews} className="whitespace-nowrap">
      {m.conv_persona_review_open}
    </Button>
  );

  if (status !== 'pending') {
    const word = status === 'approved' ? m.conv_persona_review_approved : status === 'rejected' ? m.conv_persona_review_rejected : m.conv_persona_review_resolved;
    return (
      <div className="ae-win ae-t-off my-2 flex items-center gap-2 rounded-card px-3 py-2" data-testid="persona-review-record">
        <Lamp lamp={{ tone: status === 'rejected' ? 'err' : 'ok', lit: false }} />
        <Engraved className="flex-shrink-0">{word}</Engraved>
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{item.title}</span>
        <span className="flex-shrink-0 typo-caption"><RelativeTime timestamp={item.at} /></span>
        {open}
      </div>
    );
  }

  const approve = m.quick_approve;
  const reject = m.quick_reject;
  return (
    <div className="au-scope ae-win ae-t-warn is-lit my-2 flex flex-col gap-2 rounded-card px-3 py-2.5" data-testid="persona-review-card">
      <AskHead
        kind={m.dc_deck_kind_review}
        tier={2}
        title={item.title ?? ''}
        context={<RelativeTime timestamp={item.at} />}
        body={item.body}
        outcomes={[{ verb: approve.toLowerCase(), effect: m.dc_deck_yes_review }, { verb: reject.toLowerCase(), effect: m.dc_deck_no_review }]}
        stacked={false}
      />
      <div className="grid max-w-[28rem] grid-cols-2 gap-2">
        <Verdict label={approve} yes tone="success" icon={<Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />} pair disabled={busy} onClick={() => run(() => resolveReviewRow(row, 'approved'))} />
        <Verdict label={reject} yes={false} tone="danger" icon={<X className="h-4 w-4" strokeWidth={2.5} aria-hidden />} pair disabled={busy} onClick={() => run(() => resolveReviewRow(row, 'rejected'))} />
      </div>
      {actions.map((a) => (
        <Branch key={a} label={a} hint={m.quick_carry_out_hint} accent onClick={() => run(() => dispatchReviewRowAction(row, a))} />
      ))}
      <div className="flex justify-end">{open}</div>
    </div>
  );
});

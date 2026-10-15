/**
 * The Sign card's body: the envelope as a readable document (who asks is
 * already the head's context line, so the body starts at the envelope), top to bottom
 * in the order the operator weighs it:
 *   what the steward decides alone   (plain words; toggles under E)
 *   the warning                      (right under the scopes, only when info
 *                                     reviews are delegated: an approved
 *                                     review cannot be undone)
 *   merges                           (the three policies, always a live choice)
 *   spend cap this month             (a figure; a field under E)
 * and, in the ledger rail (`SignRail`), what the charter always refuses and
 * what signing releases (the items held on this draft, from the lanes
 * snapshot; where each will go is the router's, so it says it is not
 * forecast rather than guessing).
 */
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../../model/decisionModel';
import { grantsFinalReviews } from '../../mandate/envelope';
import { useRefusalClasses } from '../../mandate/useRefusalClasses';
import { useDeckLanes } from './DeckLaneContext';
import { CapRow, GrantsBox, MergeRow, ScopesRow } from './SignParts';
import { SignReread } from './SignReread';
import type { SignShape } from './useSignShape';

/** A block in the ledger rail: eyebrow over its lines. */
function RailBlock({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1" data-testid={testId}>
      <span className="typo-eyebrow text-foreground">{label}</span>
      {children}
    </section>
  );
}

function Refuses({ item }: { item: DecisionItem }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const classes = useRefusalClasses(item.sourceId, item.payload?.stewardPersonaId ?? null);
  const text = classes === null
    ? m.ml_loading
    : classes === 'failed'
      ? m.ml_sign_refuses_failed
      : classes.length === 0 ? m.ml_sign_refuses_none : classes.join(' · ');
  return (
    <RailBlock label={m.ml_sign_refuses} testId="sign-refuses">
      <span className={`typo-body [overflow-wrap:anywhere] ${classes === 'failed' ? 'text-status-warning' : 'text-foreground'}`}>{text}</span>
    </RailBlock>
  );
}

function Forecast({ charterId }: { charterId: string }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const held = useDeckLanes().charters.get(charterId)?.held;
  const line = held === undefined
    ? null
    : held === 0 ? m.ml_sign_forecast_none
      : held === 1 ? tx(m.ml_sign_forecast_held_one, { count: held }) : tx(m.ml_sign_forecast_held_other, { count: held });
  return (
    <RailBlock label={m.ml_sign_forecast} testId="sign-forecast">
      {line && <span className="typo-body text-foreground">{line}</span>}
      <span className="typo-caption">{m.ml_sign_forecast_unavailable}</span>
    </RailBlock>
  );
}

export function SignBody({ item, sign }: { item: DecisionItem; sign: SignShape }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const { draft, envelope } = sign;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4 pl-[5.75rem] pr-8" data-deck-scroll={item.id} data-testid="sign-body">
      {draft ? (
        <>
          {sign.rereadInfo && <SignReread info={sign.rereadInfo} />}
          {sign.armed && envelope && <GrantsBox grants={sign.grants} envelope={envelope} />}
          <ScopesRow draft={draft} editing={sign.editing} onChange={sign.setDraft} />
          {envelope && grantsFinalReviews(envelope) && (
            <p className="au-armed au-l-warning flex max-w-[68ch] items-start gap-2 rounded-input px-3 py-2" role="note" data-testid="sign-review-final">
              <Lock className="au-ink-lamp mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              <span className="typo-body text-foreground">{m.ml_sign_review_final}</span>
            </p>
          )}
          <MergeRow draft={draft} onChange={sign.setDraft} />
          <CapRow cap={sign.cap} editing={sign.editing} onChange={sign.setCap} />
        </>
      ) : (
        <span className="typo-body text-status-warning">{m.ml_stewards_failed}</span>
      )}
    </div>
  );
}

/** The Sign card's rail section: what the charter always refuses and what signing releases. */
export function SignRail({ item }: { item: DecisionItem }) {
  // A re-read is of a SIGNED mandate: nothing is held on it, so no forecast.
  return (
    <div className="flex flex-col gap-3">
      <Refuses item={item} />
      {!item.payload?.reread && <Forecast charterId={item.sourceId} />}
    </div>
  );
}

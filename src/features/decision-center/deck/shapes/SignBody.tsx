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
 * A re-read (a SIGNED mandate) asks about its use, not its merges or its cap:
 * there the two fold into one counted line until E opens the envelope, so the
 * warning under the scopes is never pushed below the fold.
 * And, in the ledger rail (`SignRail`), what the charter always refuses and
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
import { mergeLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';
import { DeckFold } from '../DeckFold';
import { CapRow, GrantsBox, MergeRow, ScopesRow, useUsd } from './SignParts';
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
  // The classes are identifiers (a library name or `custom:<name>`), so they
  // read as code, as the charter editor shows them, never as loose prose.
  const listed = Array.isArray(classes) && classes.length > 0 ? classes : null;
  const text = classes === null
    ? m.ml_loading
    : classes === 'failed' ? m.ml_sign_refuses_failed : m.ml_sign_refuses_none;
  return (
    <RailBlock label={m.ml_sign_refuses} testId="sign-refuses">
      {listed ? (
        <span className="flex flex-wrap gap-x-2 gap-y-1">
          {listed.map((c) => <code key={c} className="typo-code text-foreground [overflow-wrap:anywhere]">{c}</code>)}
        </span>
      ) : (
        <span className={`typo-body ${classes === 'failed' ? 'text-status-warning' : 'text-foreground'}`}>{text}</span>
      )}
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

/** Merges and the cap: open rows on a draft or under E, one folded line on a re-read. */
function MergeAndCap({ sign, folded }: { sign: SignShape; folded: boolean }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const usd = useUsd();
  const draft = sign.draft;
  if (!draft) return null;
  const rows = (
    <div className="flex flex-col gap-3">
      <MergeRow draft={draft} onChange={sign.setDraft} />
      <CapRow cap={sign.cap} editing={sign.editing} onChange={sign.setCap} />
    </div>
  );
  if (!folded) return rows;
  const cap = sign.cap !== null ? usd(sign.cap) : m.ml_sign_budget_none;
  return (
    <DeckFold id="sign-merge-cap" title={`${m.ml_sign_merge} · ${m.ml_sign_budget}`} summary={`${mergeLabel(m, draft.mergePolicy)} · ${cap}`}>
      {rows}
    </DeckFold>
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
          <MergeAndCap sign={sign} folded={!!sign.rereadInfo && !sign.editing} />
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

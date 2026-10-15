/**
 * The Breach card's body, in the order the operator decides it: why it
 * reached you, what an amend would change (only where both sides are known),
 * the incident sheet on a stop, the other items the router coalesced on the
 * same clause (folded, counted), and the case itself (folded when long).
 */
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../../model/decisionModel';
import { DeckFold } from '../DeckFold';
import { previewOf, QUESTION_BODY_FOLD_CHARS } from '../foldPlan';
import { ClauseBand, ClauseDiff, IncidentSheet } from './BreachParts';
import type { ShapeController } from './useShapeController';

function Behind({ items }: { items: DecisionItem[] }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const count = items.length;
  const counted = count === 1 ? tx(m.ml_breach_behind_one, { count }) : tx(m.ml_breach_behind_other, { count });
  return (
    <DeckFold id="behind" title={m.ml_breach_behind} summary={`${counted} · ${items[0]!.title}`}>
      <ul className="flex flex-col gap-1">
        {items.map((i) => <li key={i.id} className="typo-body text-foreground [overflow-wrap:anywhere]">{i.title}</li>)}
      </ul>
    </DeckFold>
  );
}

export function BreachBody({ item, ctl }: { item: DecisionItem; ctl: ShapeController }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const { plan } = ctl.breach;
  const caseBody = <MarkdownRenderer content={item.body} className="typo-body text-foreground" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4 pl-[5.75rem] pr-8" data-deck-scroll={item.id} data-testid="breach-body">
      {plan && <ClauseBand clause={plan.clause} />}
      {plan && <ClauseDiff plan={plan} mandate={ctl.mandate} cap={ctl.breach.cap} onCap={ctl.breach.setCap} />}
      {plan?.clause === 'stop' && item.kind === 'incident' && <IncidentSheet item={item} />}
      {ctl.behind.length > 0 && <Behind items={ctl.behind} />}
      {item.body.length > QUESTION_BODY_FOLD_CHARS ? (
        <DeckFold id="case" title={m.dc_deck_fold_case} summary={previewOf(item.body)}>{caseBody}</DeckFold>
      ) : (
        <div className="au-lineage relative max-w-[66ch] pl-5">{caseBody}</div>
      )}
    </div>
  );
}

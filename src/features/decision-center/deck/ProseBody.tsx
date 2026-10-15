/**
 * The argument column for approval and backlog cards — BacklogDetailLedger's
 * prose half: the case as markdown at a ~68ch measure behind a lineage rule,
 * the why-raised block, evidence in monospace that wraps in place.
 *
 * Long sections FOLD (`DeckFold`) to one counted line, so the default card
 * shows the ask, the outcome pair and any answer fields without scrolling:
 * evidence past a few lines, a why-raised longer than a short paragraph, and
 * — only on a question card, where the fields must stay in view — a long case.
 */
import type { ReactNode } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../model/decisionModel';
import { DeckFold, DeckSection } from './DeckFold';
import { foldPlan } from './foldPlan';

/** `lead` sits above the case (a valve's step); `children` below it (answer fields, a claim's checklist). */
export function ProseBody({ item, lead, children }: { item: DecisionItem; lead?: ReactNode; children?: ReactNode }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const plan = foldPlan(item);
  // Evidence folds only past several lines, so its count is always plural.
  const counted = (count: number, unit: 'lines' | 'paragraphs') => unit === 'lines'
    ? tx(m.dc_deck_fold_lines, { count })
    : count === 1 ? m.dc_deck_fold_paragraphs_one : tx(m.dc_deck_fold_paragraphs_other, { count });
  const summary = (count: number, preview: string, unit: 'lines' | 'paragraphs') =>
    tx(m.dc_deck_fold_summary, { count: counted(count, unit), preview });

  const caseBody = <MarkdownRenderer content={item.body} className="typo-body-lg text-foreground" />;
  const reasoning = item.reasoning?.trim() ? <MarkdownRenderer content={item.reasoning} className="typo-body text-foreground" /> : null;
  const evidence = item.evidence
    ? <pre className="au-well whitespace-pre-wrap break-words rounded-card px-4 py-3 typo-code text-foreground">{item.evidence}</pre>
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-5 pl-[5.75rem] pr-8" data-deck-scroll={item.id}>
      {lead}
      {plan.body ? (
        <DeckFold id="case" title={m.dc_deck_fold_case} summary={summary(plan.body.count, plan.body.preview, 'paragraphs')}>
          {caseBody}
        </DeckFold>
      ) : (
        <div className="au-lineage relative max-w-[66ch] pl-5">{caseBody}</div>
      )}
      {children}
      {reasoning && (plan.reasoning ? (
        <DeckFold id="why" title={m.dc_deck_why_raised} summary={summary(plan.reasoning.count, plan.reasoning.preview, 'paragraphs')}>
          {reasoning}
        </DeckFold>
      ) : (
        <DeckSection title={m.dc_deck_why_raised}>{reasoning}</DeckSection>
      ))}
      {evidence && (plan.evidence ? (
        <DeckFold id="evidence" title={m.dc_deck_evidence} summary={summary(plan.evidence.count, plan.evidence.preview, 'lines')}>
          {evidence}
        </DeckFold>
      ) : (
        <DeckSection title={m.dc_deck_evidence}>{evidence}</DeckSection>
      ))}
    </div>
  );
}

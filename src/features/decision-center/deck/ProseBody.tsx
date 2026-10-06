/**
 * The argument column for approval and backlog cards — BacklogDetailLedger's
 * prose half: the case as markdown at a ~68ch measure behind a lineage rule,
 * the why-raised block, evidence in monospace that wraps in place.
 */
import type { ReactNode } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../model/decisionModel';

export function ProseBody({ item, children }: { item: DecisionItem; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto py-6 pl-[5.75rem] pr-8" data-deck-scroll={item.id}>
      <div className="au-lineage relative max-w-[66ch] pl-5">
        <MarkdownRenderer content={item.body} className="typo-body-lg text-foreground" />
      </div>
      {children}
      {item.reasoning?.trim() && (
        <section className="flex max-w-[68ch] flex-col gap-1.5">
          <span className="typo-eyebrow text-foreground">{t.monitor.dc_deck_why_raised}</span>
          <MarkdownRenderer content={item.reasoning} className="typo-body text-foreground" />
        </section>
      )}
      {item.evidence && (
        <section className="flex max-w-[68ch] flex-col gap-1.5">
          <span className="typo-eyebrow text-foreground">{t.monitor.dc_deck_evidence}</span>
          <pre className="au-well whitespace-pre-wrap break-words rounded-card px-4 py-3 typo-code text-foreground">{item.evidence}</pre>
        </section>
      )}
    </div>
  );
}

/**
 * The argument column for approval and backlog cards — BacklogDetailLedger's
 * prose half: the case as markdown at a ~68ch measure behind a lineage rule,
 * the why-raised block, evidence in monospace that wraps in place.
 */
import type { ReactNode } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DecisionItem } from '../../../model/decisionModel';

export function ProseBody({ item, children }: { item: DecisionItem; children?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5" data-p2-scroll={item.id}>
      <div className="max-w-[68ch] border-l-2 border-primary/30 pl-4">
        <MarkdownRenderer content={item.body} className="typo-body-lg text-foreground" />
      </div>
      {children}
      {item.reasoning?.trim() && (
        <section className="flex max-w-[68ch] flex-col gap-1.5">
          <span className="typo-label">Why it was raised</span>
          <MarkdownRenderer content={item.reasoning} className="typo-body text-foreground" />
        </section>
      )}
      {item.evidence && (
        <section className="flex max-w-[68ch] flex-col gap-1.5">
          <span className="typo-label">Evidence</span>
          <pre className="whitespace-pre-wrap break-words rounded-card bg-secondary/40 p-3 typo-code text-foreground">{item.evidence}</pre>
        </section>
      )}
    </div>
  );
}

/**
 * The argument column for approval and backlog cards — BacklogDetailLedger's
 * prose half: the case as markdown at a ~68ch measure behind a lit lineage
 * rule, the why-raised block, evidence in a recessed monospace well.
 */
import type { ReactNode } from 'react';
import { FileSearch, HelpCircle } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DecisionItem } from '../../../model/decisionModel';

function Section({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[68ch] flex-col gap-2">
      <span className="flex items-center gap-1.5 typo-label">{icon}{label}</span>
      {children}
    </section>
  );
}

export function ProseBody({ item, children }: { item: DecisionItem; children?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-5 pt-1" data-r2a-scroll={item.id}>
      <div className="r2a-case max-w-[68ch]">
        <MarkdownRenderer content={item.body} className="typo-body-lg text-foreground" />
      </div>
      {children}
      {item.reasoning?.trim() && (
        <Section icon={<HelpCircle className="h-3.5 w-3.5" aria-hidden />} label="Why it was raised">
          <MarkdownRenderer content={item.reasoning} className="typo-body text-foreground" />
        </Section>
      )}
      {item.evidence && (
        <Section icon={<FileSearch className="h-3.5 w-3.5" aria-hidden />} label="Evidence">
          <pre className="r2a-well whitespace-pre-wrap break-words rounded-card p-3 typo-code text-foreground">{item.evidence}</pre>
        </Section>
      )}
    </div>
  );
}

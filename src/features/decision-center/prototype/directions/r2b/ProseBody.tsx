/**
 * The argument column for approval and backlog cards, on the hanging-label
 * grid: a margin column of small-caps labels, every block of content on ONE
 * left edge, hairlines between rows —
 *   CASE      the case as markdown at a ~68ch measure
 *   ANSWERS   (question cards) the fields
 *   SCORE     scored facts as instrument meters, side by side
 *   RECORD    the plain facts as read-outs: label over figure
 *   WHY       why it was raised
 *   EVIDENCE  monospace that wraps in place
 * The Score and Record rows are what used to crowd the rail; here they have the width.
 */
import type { ReactNode } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DecisionItem } from '../../../model/decisionModel';
import { factIcon } from './deckMeta';
import { metersOf, plainFactsOf } from './LedgerRail';
import { ScoreMeter } from './ScoreMeter';

function Sec({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <section className="r2b-sec" data-testid={testId}>
      <span className="r2b-sec-label typo-eyebrow">{label}</span>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function ProseBody({ item, children }: { item: DecisionItem; children?: ReactNode }) {
  const facts = plainFactsOf(item);
  const meters = metersOf(item);
  return (
    <div className="r2b-body" data-r2b-scroll={item.id}>
      <Sec label="Case">
        <MarkdownRenderer content={item.body} className="typo-body-lg text-foreground" />
      </Sec>
      {children && <Sec label="Answers">{children}</Sec>}
      {meters.length > 0 && (
        <Sec label="Score" testId="r2b-score">
          <div className="r2b-scores" data-n={Math.min(meters.length, 3)}>
            {meters.map((f) => <ScoreMeter key={f.id} fact={f} />)}
          </div>
        </Sec>
      )}
      {facts.length > 0 && (
        <Sec label="Record" testId="r2b-record">
          <div className="r2b-readouts">
            {facts.map((f) => {
              const Icon = factIcon(f);
              return (
                <div key={f.id} className="r2b-readout">
                  <span className="r2b-readout-label typo-caption">
                    {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
                    {f.label}
                  </span>
                  <span className="r2b-figure-md r2b-num">{f.value}</span>
                </div>
              );
            })}
          </div>
        </Sec>
      )}
      {item.reasoning?.trim() && (
        <Sec label="Why">
          <MarkdownRenderer content={item.reasoning} className="typo-body text-foreground" />
        </Sec>
      )}
      {item.evidence && (
        <Sec label="Evidence">
          <pre className="r2b-evidence typo-code">{item.evidence}</pre>
        </Sec>
      )}
    </div>
  );
}

/**
 * backlog — the ledger lineage of BacklogDetailLedger, calmed: the case on the
 * left (description, reasoning, evidence), the ledger rail on the right
 * (where it comes from, then effort / impact / risk as meters).
 */
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DecisionItem } from '../../../model/decisionModel';
import { Block, Consequence, ScoreMeter } from './BodyParts';
import { COPY } from './copy';

export function BacklogBody({ item }: { item: DecisionItem }) {
  const scored = item.facts.filter((f) => f.score);
  const plain = item.facts.filter((f) => !f.score);
  const category = item.tags.find((t) => t.id === 'cat');
  const origin = item.tags.find((t) => t.id === 'origin');
  const lineage: Array<[string, string]> = [
    ...plain.map((f): [string, string] => [f.label, f.value]),
    ...(category ? [[COPY.sheet.category, category.label] as [string, string]] : []),
    ...(origin ? [[COPY.sheet.origin, origin.label] as [string, string]] : []),
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_15rem] gap-6 px-6 pb-6">
      <div className="min-w-0 space-y-5">
        <Consequence item={item} />
        <Block label={COPY.sheet.case}>
          <MarkdownRenderer content={item.body} variant="document" />
        </Block>
        {item.reasoning && (
          <Block label={COPY.sheet.why}>
            <p className="typo-body text-foreground">{item.reasoning}</p>
          </Block>
        )}
        {item.evidence && (
          <Block label={COPY.sheet.evidence}>
            <pre className="p1-evidence px-3 py-2.5 typo-code text-foreground">{item.evidence}</pre>
          </Block>
        )}
      </div>
      <aside className="space-y-5 border-l p1-hair pl-5">
        {lineage.length > 0 && (
          <dl className="space-y-2.5">
            {lineage.map(([k, v]) => (
              <div key={k}>
                <dt className="typo-eyebrow text-foreground">{k}</dt>
                <dd className="typo-body text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {scored.length > 0 && (
          <div className="space-y-3">
            {scored.map((f) => <ScoreMeter key={f.id} fact={f} />)}
          </div>
        )}
      </aside>
    </div>
  );
}

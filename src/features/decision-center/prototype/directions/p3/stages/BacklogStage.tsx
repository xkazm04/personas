/**
 * backlog — the ledger lineage: description, reasoning and evidence on the
 * page; a ledger column with where it came from and the three score meters.
 */
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { KeyValueGrid, KitHost } from '@/features/shared/components/kit';
import type { DecisionItem } from '../../../../model/decisionModel';
import { ScoreMeter } from '../parts';

/** A tag is optional metadata on the item: absent means "not stated", rendered as a dash. */
function tagLabel(item: DecisionItem, id: string): string | null {
  const tag = item.tags.find((t) => t.id === id);
  return tag ? tag.label : null;
}

export function BacklogStage({ item }: { item: DecisionItem }) {
  const scored = item.facts.filter((f) => f.score);
  const project = item.facts.find((f) => f.id === 'project')?.value ?? item.source.label;
  const category = tagLabel(item, 'cat');
  const origin = tagLabel(item, 'origin') ?? item.source.sublabel ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-6 px-6 pb-6">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="p3-ask is-calm flex flex-col gap-1 px-4 py-3">
          <span className="typo-label text-primary">If you accept</span>
          <span className="typo-body-lg text-foreground">It joins Ready to dispatch. Build now (1) also queues the task immediately.</span>
        </div>
        <section className="flex flex-col gap-1.5">
          <span className="typo-label text-foreground">What and why</span>
          <MarkdownRenderer content={item.body} variant="card" />
        </section>
        {item.reasoning && (
          <section className="flex flex-col gap-1.5">
            <span className="typo-label text-foreground">Reasoning</span>
            <p className="typo-body text-foreground">{item.reasoning}</p>
          </section>
        )}
        {item.evidence && (
          <section className="flex flex-col gap-1.5">
            <span className="typo-label text-foreground">Evidence</span>
            <pre className="typo-code overflow-x-auto rounded-input border border-border bg-secondary/40 px-3 py-2 text-foreground">{item.evidence}</pre>
          </section>
        )}
      </div>
      <aside className="flex flex-col gap-4 rounded-card border border-border bg-secondary/30 p-4" aria-label="Ledger">
        <KitHost>
          <KeyValueGrid min="100%" items={[
            { k: 'Project', v: project },
            { k: 'Category', v: category, none: '—' },
            { k: 'Origin', v: origin, none: '—' },
          ]} />
        </KitHost>
        <div className="flex flex-col gap-3">
          {scored.map((f) => <ScoreMeter key={f.id} fact={f} />)}
        </div>
      </aside>
    </div>
  );
}

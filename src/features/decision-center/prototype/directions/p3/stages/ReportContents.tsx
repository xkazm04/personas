/** The reading room's right column: how far in, the contents, the facts. */
import { Button } from '@/features/shared/components/buttons';
import { KeyValueGrid, KitHost } from '@/features/shared/components/kit';
import type { DecisionItem } from '../../../../model/decisionModel';
import { costOf, type Heading } from '../model';

interface Props {
  item: DecisionItem;
  headings: Heading[];
  progress: number;
  activeId: string | null;
  onJump: (id: string) => void;
}

export function ReportContents({ item, headings, progress, activeId, onJump }: Props) {
  const pct = Math.round(progress * 100);
  return (
    <aside className="p3-toc flex flex-col gap-5 px-4 py-5" aria-label="Reading aids">
      <div className="p3-ask is-calm flex flex-col gap-1 px-3 py-2.5">
        <span className="typo-label text-primary">Your call</span>
        <span className="typo-body text-foreground">
          {item.kind === 'council'
            ? 'Approve (A, then ↵) or send it back with a reason (R).'
            : 'Read it, then Done (D) — or follow up in chat (1).'}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="typo-label text-foreground">Progress</span>
        <span className="typo-data-lg tabular-nums text-foreground">{pct}%</span>
        <span className="typo-caption">{costOf(item)}</span>
      </div>
      <nav className="flex flex-col gap-0.5" aria-label="Contents">
        <span className="typo-label pb-1 text-foreground">Contents</span>
        {headings.length === 0 && <span className="typo-caption">A designed HTML page — no outline to list.</span>}
        {headings.map((h) => {
          const on = h.id === activeId;
          return (
            <Button key={h.id} variant="ghost" size="xs" onClick={() => onJump(h.id)} aria-current={on ? 'location' : undefined}
              className={`justify-start text-left ${h.depth > 2 ? 'pl-5' : h.depth === 1 ? '' : 'pl-3'} ${on ? 'bg-primary/10' : ''}`}>
              <span className={`typo-caption ${on ? 'text-primary' : 'text-foreground'}`}>{h.text}</span>
            </Button>
          );
        })}
      </nav>
      {item.facts.length > 0 && (
        <KitHost>
          <KeyValueGrid min="100%" items={item.facts.map((f) => ({ k: f.label, v: f.value }))} />
        </KitHost>
      )}
    </aside>
  );
}

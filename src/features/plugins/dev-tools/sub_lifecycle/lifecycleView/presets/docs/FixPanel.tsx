// FIX IN BULK: how many docs need work (broken and stale; an unverifiable doc
// is not rot, it is unchecked), one press that hands them ALL to Athena with
// the same prompt the Next panel sends, and the doc-rot items the backlog
// already holds - each tied to the doc its title names, opened in place - so
// a reader sees what is filed before asking for it twice.
import { Sparkles } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import { ListRow, Meta, Rows, Section } from '@/features/shared/components/kit';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

import { useLifecycleViewModel } from '../../context';
import { useRelatedItem } from '../../layer2/related/relatedItem';
import { ItemPill, itemStatusLabel } from '../../system/Pill';
import { GLYPH } from '../../system/scales';
import { docRotItems } from './backlogMatch';
import { fixDocsPrompt } from './docsAsk';
import type { DocsView } from './useDocsView';

function ItemRow({ item, doc, onShow }: { item: LifecycleRelatedItem; doc: string | undefined; onShow: (doc: string) => void }) {
  const { dl } = useLifecycleViewModel();
  const { open } = useRelatedItem();
  return (
    <ListRow
      name={item.title}
      // The title already names the doc; the meta takes the reader to its row.
      meta={doc ? (
        <Button variant="link" size="xs" onClick={() => onShow(doc)} data-testid={`lcx7-backlog-show-${item.id}`}>
          {dl.lcx7_backlog_show}
        </Button>
      ) : <span>{dl.lcx7_backlog_no_doc}</span>}
      mark={{ tone: doc ? 'info' : 'neutral', glyph: 'hollow', label: itemStatusLabel(dl, item.status) }}
      figures={<ItemPill status={item.status} />}
      time={<RelativeTime timestamp={item.createdAt} />}
      onPress={() => open(item.id)}
      testId={`lcx7-backlog-${item.id}`}
    />
  );
}

export function FixPanel({ view, related }: { view: DocsView; related: LifecycleRelatedItem[] }) {
  const { dl, tx, projectId, projectName } = useLifecycleViewModel();
  const ask = useAskAthena();
  const { broken, stale } = view.toFix;
  const docs = [...broken, ...stale];
  const items = docRotItems(related);
  if (docs.length === 0 && items.length === 0) return null;
  const filed = docs.filter((d) => view.backlog.byDoc.has(d)).length;
  const meta = docs.length === 0 ? [dl.lcx7_fix_none] : [
    broken.length > 0 && <span key="b" className="text-status-error">{tx(dl.lcx7_n_broken, { count: broken.length })}</span>,
    stale.length > 0 && <span key="s" className="text-status-warning">{tx(dl.lcx7_n_stale, { count: stale.length })}</span>,
    tx(dl.lcx7_backlog_of, { filed, count: docs.length }),
  ];
  const action = docs.length > 0 && (
    <Button
      variant="accent"
      tone="agent"
      size="sm"
      icon={<Sparkles className={GLYPH.sm} />}
      onClick={() => ask('lifecycle', fixDocsPrompt({ dl, tx }, { name: projectName ?? '', id: projectId ?? '' }, docs))}
      data-testid="lcx7-fix-all"
    >
      {docs.length === 1 ? dl.lcx7_fix_all_one : tx(dl.lcx7_fix_all, { count: docs.length })}
    </Button>
  );
  return (
    <Section title={dl.lcx7_fix_title} level={2} count={docs.length || undefined} meta={<Meta parts={meta} />} desc={dl.lcx7_backlog_head} actions={action}>
      <div data-testid="lcx7-fix">
        <Rows count={items.length} empty={{ title: dl.lcx7_backlog_none }}>
          {items.map((item) => <ItemRow key={item.id} item={item} doc={view.backlog.docOf.get(item.id)} onShow={view.pick} />)}
        </Rows>
      </div>
    </Section>
  );
}

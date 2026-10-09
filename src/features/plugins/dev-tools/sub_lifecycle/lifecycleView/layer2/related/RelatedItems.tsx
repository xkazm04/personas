/**
 * The backlog items about this step, at the foot of its screen: what the
 * slow-gate sensor filed about its commands, the Overseer's items for it, the
 * doc-rot items (docs). One compact row each - the source's glyph and the
 * title, where it came from, its status as the module's pill, when it was
 * filed - and pressing a row opens the item (`relatedItem`). No items, no
 * section: an empty list says nothing worth a heading.
 */
import { ArrowUpRight, FileWarning, Gauge, Radar, type LucideIcon } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ListRow, Rows, Section } from '@/features/shared/components/kit';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import type { LifecycleRelatedSource } from '@/lib/bindings/LifecycleRelatedSource';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { ItemPill, itemStatusLabel } from '../../system/Pill';
import { ITEM_LOOK, MARK_TONE, itemStatusOf } from '../../system/pillLooks';
import { GLYPH } from '../../system/scales';
import { useRelatedItem } from './relatedItem';
import { RelatedNote } from './RelatedNote';

export const SOURCE_GLYPH: Record<LifecycleRelatedSource, LucideIcon> = {
  slow_gate: Gauge,
  overseer: Radar,
  doc_rot: FileWarning,
};

export function useSourceLabel() {
  const { dl } = useLifecycleViewModel();
  return (s: LifecycleRelatedSource): string => ({
    slow_gate: dl.lcx5_source_slow_gate,
    overseer: dl.lcx5_source_overseer,
    doc_rot: dl.lcx5_source_doc_rot,
  })[s];
}

function Row({ item }: { item: LifecycleRelatedItem }) {
  const { dl } = useLifecycleViewModel();
  const { open } = useRelatedItem();
  const source = useSourceLabel();
  const look = ITEM_LOOK[itemStatusOf(item.status)];
  const Glyph = SOURCE_GLYPH[item.source];
  return (
    <ListRow
      name={(
        <span className="flex min-w-0 items-center gap-2">
          <Glyph className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden />
          <span className="min-w-0 truncate">{item.title}</span>
        </span>
      )}
      meta={<><span>{source(item.source)}</span>{item.commandId && <span className={LT.code}>{item.commandId}</span>}</>}
      mark={{ tone: MARK_TONE[look.tone], glyph: look.stroke === 'solid' ? 'solid' : 'hollow', label: itemStatusLabel(dl, item.status) }}
      figures={<ItemPill status={item.status} />}
      time={<RelativeTime timestamp={item.createdAt} />}
      onPress={() => open(item.id)}
      testId={`lc2-related-${item.id}`}
    />
  );
}

export function RelatedItems({ items }: { items: LifecycleRelatedItem[] }) {
  const { dl } = useLifecycleViewModel();
  const { openBacklog } = useRelatedItem();
  if (items.length === 0) return null;
  const actions = (
    <Button variant="ghost" size="sm" iconRight={<ArrowUpRight className={GLYPH.sm} />} onClick={openBacklog} data-testid="lc2-related-backlog">
      {dl.lcx5_open_backlog}
    </Button>
  );
  return (
    <Section title={dl.lcx5_related_title} level={2} count={items.length} actions={actions}>
      <div data-testid="lc2-related">
        <Rows count={items.length} cap={10} empty={{ title: '' }}>
          {items.map((item) => <Row key={item.id} item={item} />)}
        </Rows>
      </div>
      <RelatedNote />
    </Section>
  );
}

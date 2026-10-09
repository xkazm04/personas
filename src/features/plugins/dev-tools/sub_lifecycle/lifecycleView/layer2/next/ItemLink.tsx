// A backlog item named inside a sentence ("Filed as a backlog item: tsc is
// slow (accepted)"): its title and status as a link that opens the item in
// place (`related/relatedItem`), spinning while the item is read.
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import { Button } from '@/features/shared/components/buttons';

import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { itemStatusLabel } from '../../system/Pill';
import { useRelatedItem } from '../related/relatedItem';

export function ItemLink({ item }: { item: LifecycleRelatedItem }) {
  const { dl, tx } = useLifecycleViewModel();
  const { open, openingId } = useRelatedItem();
  return (
    <Button
      variant="link"
      size="xs"
      loading={openingId === item.id}
      onClick={() => open(item.id)}
      // The label span the button wraps its children in must shrink too, or the title cannot truncate.
      className="min-w-0 max-w-full overflow-hidden [&>span]:min-w-0"
      data-testid={`lc2-item-link-${item.id}`}
    >
      <span className="block min-w-0 truncate">{tx(dl.lcx5_item_with_status, { title: item.title, status: itemStatusLabel(dl, item.status) })}</span>
    </Button>
  );
}

/**
 * "Filed as a backlog item: <the item>", in the translator's word order. A flex
 * line: the words keep their width and the link takes what is left, truncated.
 */
export function Filed({ item }: { item: LifecycleRelatedItem }) {
  const { dl } = useLifecycleViewModel();
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
      {fillTemplate(dl.lcx5_next_filed, { item: <ItemLink item={item} /> })}
    </span>
  );
}

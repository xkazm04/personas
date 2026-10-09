/**
 * The items the Overseer still owes, at layer one: one chip per open item in
 * the goal strip, in step order - the step's key glyph and name, in his role
 * colour (a reopened item in the warning tone, "Regressed"). The item's own
 * title is the chip's tooltip; where the strip has room (a wide screen) the
 * chip says the title too, truncated. Pressing a chip opens the item in
 * place, through the same item opener a step screen's related items use, and
 * the chip spins while the item is read.
 */
import { Button } from '@/features/shared/components/buttons';
import type { ButtonTone } from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { LifecycleGoalItem } from '@/lib/bindings/LifecycleGoalItem';

import { stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { useRelatedItem } from '../layer2/related/relatedItem';
import { itemStatusLabel } from '../system/Pill';
import { GLYPH } from '../system/scales';
import { itemState } from './goalModel';

function Chip({ item }: { item: LifecycleGoalItem }) {
  const { dl, tx, order } = useLifecycleViewModel();
  const { open, openingId } = useRelatedItem();
  const node = order.find((n) => n.id === item.stepId);
  const step = stepLabel(dl, item.stepId, node?.label ?? null);
  const regressed = itemState(item) === 'regressed';
  const status = regressed ? dl.lcx9_item_regressed : itemStatusLabel(dl, item.status);
  const described = tx(dl.lcx5_item_with_status, { title: item.title, status });
  const tone: ButtonTone = regressed ? 'warning' : 'agent';
  const Glyph = stepGlyph(item.stepId);
  return (
    <Tooltip content={described}>
      <Button
        variant="accent"
        tone={tone}
        size="xs"
        icon={<Glyph className={GLYPH.sm} />}
        loading={openingId === item.id}
        onClick={() => open(item.id)}
        aria-label={tx(dl.lcx9_chip_label, { step, item: described })}
        className="max-w-full min-w-0 [&>span]:min-w-0"
        data-testid={`lc9-goal-chip-${item.id}`}
        data-state={regressed ? 'regressed' : item.status}
      >
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="shrink-0">{step}</span>
          <span className="hidden min-w-0 max-w-[16rem] truncate @[78rem]/goal:inline">{`· ${item.title}`}</span>
        </span>
      </Button>
    </Tooltip>
  );
}

export function OpenItemChips({ items }: { items: LifecycleGoalItem[] }) {
  if (items.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="lc9-goal-chips">
      {items.map((item) => <Chip key={item.id} item={item} />)}
    </span>
  );
}

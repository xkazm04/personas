/**
 * The Overseer's mark on a rail card: the step has an item he still owes (or
 * reopened because it regressed). His mark at the system's small glyph size on
 * his filled chip, in the card's head row after the step's name; its tooltip
 * says which. The card's peek lists the item itself (`OverseerPeek`). Not a
 * press target: the card is (its key's stretched hit area); the badge only
 * lifts above that hit area so a pointer resting on it can read its tip.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { GoalItemPill } from './GoalItemRow';
import { itemState, openItemsFor } from './goalModel';
import { OverseerMark } from './OverseerMark';

/** A step's open Overseer items, read from the snapshot's goal. */
export function useOverseerItems(stepId: string) {
  const { snapshot } = useLifecycleViewModel();
  return openItemsFor(snapshot?.goal, stepId);
}

export function OverseerBadge({ stepId }: { stepId: string }) {
  const { dl } = useLifecycleViewModel();
  const items = useOverseerItems(stepId);
  const first = items[0];
  if (!first) return null;
  const tip = itemState(first) === 'regressed'
    ? dl.lcx9_badge_tip_regressed
    : first.status === 'pending' ? dl.lcx9_badge_tip_pending : dl.lcx9_badge_tip;
  return (
    <Tooltip content={tip}>
      <span role="img" aria-label={tip} className="relative z-10 inline-flex shrink-0" data-testid={`lc9-overseer-badge-${stepId}`} data-item={first.id}>
        <OverseerMark size="sm" />
      </span>
    </Tooltip>
  );
}

/** The peek's Overseer lines: each open item of the step, with its status. Inert like every tip. */
export function OverseerPeek({ stepId }: { stepId: string }) {
  const { dl } = useLifecycleViewModel();
  const items = useOverseerItems(stepId);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="lc9-peek-overseer">
      <span className={`flex items-center gap-1.5 ${LT.label}`}>
        <OverseerMark size="sm" />
        {dl.lcx9_peek_overseer}
      </span>
      {items.map((item) => (
        <span key={item.id} className="flex min-w-0 items-center gap-2 pl-8" data-item={item.id}>
          <span className={`min-w-0 flex-1 truncate ${LT.row}`}>{item.title}</span>
          <GoalItemPill item={item} />
        </span>
      ))}
    </div>
  );
}

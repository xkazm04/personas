/**
 * One of the Overseer's items under his goal, as a row of the goal panel: the
 * item's title (pressing it opens the item in place, the backlog's own dialog,
 * as a step screen's related items do - `layer2/related/relatedItem`), the
 * step it is about (its key glyph and name) and what last happened to it in
 * words, and its status as the module's pill. An item a Measure closed says
 * so: "Closed by Measure 2 h ago". An item a send reopened is "Regressed".
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ListRow, Meta } from '@/features/shared/components/kit';
import type { LifecycleGoalItem } from '@/lib/bindings/LifecycleGoalItem';

import { stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { fillTemplate } from '../frame/fillTemplate';
import { useRelatedItem } from '../layer2/related/relatedItem';
import { ItemPill, Pill, itemStatusLabel } from '../system/Pill';
import { ITEM_LOOK, MARK_TONE, REGRESSED_LOOK, itemStatusOf } from '../system/pillLooks';
import { GLYPH } from '../system/scales';
import { itemState, itemTime, type GoalItemState } from './goalModel';

/** The item's status as the module's pill; a reopened item reads "Regressed", not "Accepted". */
export function GoalItemPill({ item }: { item: Pick<LifecycleGoalItem, 'status' | 'verifyState'> }) {
  const { dl } = useLifecycleViewModel();
  return itemState(item) === 'regressed'
    ? <Pill look={REGRESSED_LOOK} label={dl.lcx9_item_regressed} data={{ 'data-status': 'regressed' }} />
    : <ItemPill status={item.status} />;
}

function useHappened() {
  const { dl } = useLifecycleViewModel();
  return (state: GoalItemState, changed: boolean): string => {
    if (state === 'cleared') return dl.lcx9_item_closed_by;
    if (state === 'regressed') return dl.lcx9_item_reopened;
    return changed ? dl.lcx9_item_updated : dl.lcx9_item_filed;
  };
}

export function GoalItemRow({ item }: { item: LifecycleGoalItem }) {
  const { dl, order } = useLifecycleViewModel();
  const { open } = useRelatedItem();
  const happened = useHappened();
  const state = itemState(item);
  const look = state === 'regressed' ? REGRESSED_LOOK : ITEM_LOOK[itemStatusOf(item.status)];
  const Glyph = stepGlyph(item.stepId);
  const node = order.find((n) => n.id === item.stepId);
  const step = (
    <span className="inline-flex items-center gap-1.5" data-step={item.stepId}>
      <Glyph className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden />
      {stepLabel(dl, item.stepId, node?.label ?? null)}
    </span>
  );
  const when = fillTemplate(happened(state, item.updatedAt !== null), { time: <RelativeTime timestamp={itemTime(item)} /> });
  return (
    <ListRow
      name={item.title}
      meta={<Meta parts={[step, <span key="when" data-when={state}>{when}</span>]} />}
      mark={{
        tone: MARK_TONE[look.tone],
        glyph: look.stroke === 'solid' ? 'solid' : 'hollow',
        label: state === 'regressed' ? dl.lcx9_item_regressed : itemStatusLabel(dl, item.status),
      }}
      figures={<GoalItemPill item={item} />}
      onPress={() => open(item.id)}
      testId={`lc9-goal-item-${item.id}`}
    />
  );
}

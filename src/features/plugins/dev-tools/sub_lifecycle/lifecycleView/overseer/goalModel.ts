// The Overseer's goal as his WORK: what each of his items under "All steps
// green" is doing, in the order the reader walks the practice. Pure: no
// React, no i18n.
//
// An item's state is read from two fields the backend ships (`status`, the
// backlog's own token, and `verifyState`, what a Measure or a send observed):
//
// - open        pending or accepted: he still owes this step;
// - regressed   accepted again by a send, because the step went bad after a
//               Measure had closed it (`verifyState: regressed`);
// - cleared     closed by a Measure that saw the step green
//               (`delivered`, `verifyState: cleared`): closed by OBSERVATION;
// - delivered   delivered some other way (nothing observed it);
// - decided     someone rejected, archived or let it expire: set aside.
import type { LifecycleGoalItem } from '@/lib/bindings/LifecycleGoalItem';
import type { LifecycleGoalView } from '@/lib/bindings/LifecycleGoalView';

export type GoalItemState = 'open' | 'regressed' | 'cleared' | 'delivered' | 'decided';

const OPEN_STATUSES: ReadonlySet<string> = new Set(['pending', 'accepted']);

/** Pending or accepted: the Overseer still owes the step. */
export function isOpenItem(item: Pick<LifecycleGoalItem, 'status'>): boolean {
  return OPEN_STATUSES.has(item.status);
}

export function itemState(item: Pick<LifecycleGoalItem, 'status' | 'verifyState'>): GoalItemState {
  if (isOpenItem(item)) return item.verifyState === 'regressed' ? 'regressed' : 'open';
  if (item.status === 'delivered') return item.verifyState === 'cleared' ? 'cleared' : 'delivered';
  return 'decided';
}

/** When the item last changed: its update, else when it was filed. */
export function itemTime(item: Pick<LifecycleGoalItem, 'createdAt' | 'updatedAt'>): string {
  return item.updatedAt ?? item.createdAt;
}

export interface GoalTally {
  open: number;
  closed: number;
  decided: number;
}

export function goalTally(items: readonly LifecycleGoalItem[]): GoalTally {
  const t: GoalTally = { open: 0, closed: 0, decided: 0 };
  for (const item of items) {
    const s = itemState(item);
    if (s === 'open' || s === 'regressed') t.open += 1;
    else if (s === 'decided') t.decided += 1;
    else t.closed += 1;
  }
  return t;
}

/**
 * The items in the reader's order: the ones he still owes first, then the
 * closed and the set aside; inside each, grouped by step in the practice's
 * order (`stepOrder`), a step the practice no longer has last. The sort is
 * stable, so a step's own items keep the backend's newest-first order.
 */
export function orderedItems(items: readonly LifecycleGoalItem[], stepOrder: readonly string[]): LifecycleGoalItem[] {
  const rank = (id: string) => {
    const i = stepOrder.indexOf(id);
    return i < 0 ? stepOrder.length : i;
  };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) =>
      Number(isOpenItem(b.item)) - Number(isOpenItem(a.item))
      || rank(a.item.stepId) - rank(b.item.stepId)
      || a.i - b.i)
    .map(({ item }) => item);
}

/** A step's open items (newest first, as the backend lists them). */
export function openItemsFor(goal: LifecycleGoalView | null | undefined, stepId: string): LifecycleGoalItem[] {
  return goal ? goal.items.filter((i) => i.stepId === stepId && isOpenItem(i)) : [];
}


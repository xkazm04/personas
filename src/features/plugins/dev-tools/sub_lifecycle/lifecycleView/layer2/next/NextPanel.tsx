/**
 * NEXT, under the step's band: the one to three things to do about this step,
 * most impact first (`nextModel`), each a compact action card - its glyph, what
 * the data says, the detail that makes it concrete, and the control that does
 * it. A healthy step gets one calm line and nothing else; a step with nothing
 * to act on (instructed, waiting on data) draws no panel. The Overseer's own
 * items about the step sit in the same row as one more card, of links: it is
 * already on them, so there is nothing to press but the item.
 *
 * The plan reads the step as it is NOW, whatever Measure the band is showing.
 */
import { CircleCheck, Radar } from 'lucide-react';

import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { PILL_TONE } from '../../system/pillLooks';
import { GLYPH } from '../../system/scales';
import { ItemLink } from './ItemLink';
import type { HealthyStreak, NextAction, NextPlan } from './nextModel';
import { NextCta } from './NextCta';
import { useActionView } from './useActionView';

function ActionCard({ action, node }: { action: NextAction; node: JourneyNode }) {
  const view = useActionView(action);
  const ink = PILL_TONE[view.tone].ink;
  const Glyph = view.glyph;
  return (
    <li className={`flex min-w-0 items-center gap-3 ${lcSurface('action')}`} data-testid={`lc2-next-${action.kind}`} data-next={action.kind}>
      <Glyph className={`${GLYPH.md} shrink-0 ${ink}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`truncate ${LT.row}`}>{view.title}</p>
        {view.detail && <p className={`truncate ${LT.meta}`} data-testid={`lc2-next-${action.kind}-detail`}>{view.detail}</p>}
      </div>
      <NextCta action={action} node={node} />
    </li>
  );
}

function OverseerCard({ items }: { items: LifecycleRelatedItem[] }) {
  const { dl } = useLifecycleViewModel();
  return (
    <li className={`flex min-w-0 items-center gap-3 ${lcSurface('action')}`} data-testid="lc2-next-overseer">
      <Radar className={`${GLYPH.md} shrink-0 text-primary`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-primary ${LT.row}`}>{dl.lcx5_overseer_on_it}</p>
        <p className={`flex min-w-0 items-center gap-3 ${LT.meta}`}>
          {items.slice(0, 2).map((item) => <ItemLink key={item.id} item={item} />)}
        </p>
      </div>
    </li>
  );
}

type Vm = ReturnType<typeof useLifecycleViewModel>;

/** "Healthy for the last 6 Measures" / "...done in each of the last 12 changes", with a one-count wording of each. */
function healthyLine(dl: Vm['dl'], tx: Vm['tx'], streak: HealthyStreak): string {
  if (streak.unit === 'measures') return streak.count === 1 ? dl.lcx5_healthy_measures_one : tx(dl.lcx5_healthy_measures, { count: streak.count });
  return streak.count === 1 ? dl.lcx5_healthy_changes_one : tx(dl.lcx5_healthy_changes, { count: streak.count });
}

export function NextPanel({ node, plan }: { node: JourneyNode; plan: NextPlan }) {
  const { dl, tx } = useLifecycleViewModel();
  const { actions, healthy, overseer } = plan;
  if (actions.length === 0 && !healthy && overseer.length === 0) return null;
  const streak = healthy?.streak;
  return (
    <section aria-label={dl.lcx5_next_label} data-testid="lc2-next">
      <div className="flex min-w-0 items-center gap-4">
        <h3 className={`shrink-0 ${LT.eyebrow}`}>{dl.lcx5_next}</h3>
        {healthy && (
          <p className={`flex min-w-0 items-center gap-2 ${LT.row}`} data-testid="lc2-next-healthy">
            <CircleCheck className={`${GLYPH.md} shrink-0 text-status-success`} aria-hidden />
            {streak ? healthyLine(dl, tx, streak) : dl.lcx5_healthy}
          </p>
        )}
        {actions.length + overseer.length > 0 && (
          <ol className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(22rem,1fr))] gap-2">
            {actions.map((a, i) => <ActionCard key={`${a.kind}-${i}`} action={a} node={node} />)}
            {overseer.length > 0 && <OverseerCard items={overseer} />}
          </ol>
        )}
      </div>
    </section>
  );
}

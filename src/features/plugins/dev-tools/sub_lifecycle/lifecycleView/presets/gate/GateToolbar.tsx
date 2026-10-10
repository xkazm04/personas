/**
 * The command rows' compact toolbar: the order (pipeline, slowest first,
 * least reliable first) and a filter (all, failing, over budget, flaky), each
 * filter carrying how many rows it would show. The choice is remembered per
 * step for the session (`gateView`).
 */
import { Segmented, Toolbar, type SegmentOption } from '@/features/shared/components/kit';

import { useLifecycleViewModel } from '../../context';
import type { GateFilter, GateSort, GateViewState } from './gateView';

export function GateToolbar({ view, counts, onChange }: {
  view: GateViewState;
  counts: Record<GateFilter, number>;
  onChange: (view: GateViewState) => void;
}) {
  const { dl } = useLifecycleViewModel();
  const sorts: SegmentOption<GateSort>[] = [
    { v: 'pipeline', label: dl.lcx6_sort_pipeline },
    { v: 'slowest', label: dl.lcx6_sort_slowest },
    { v: 'least_reliable', label: dl.lcx6_sort_least_reliable },
  ];
  const filters: SegmentOption<GateFilter>[] = [
    { v: 'all', label: dl.lcx6_filter_all, count: counts.all },
    { v: 'failing', label: dl.lcx6_filter_failing, count: counts.failing, tone: 'error', glyph: 'solid' },
    { v: 'over_budget', label: dl.lcx6_filter_over_budget, count: counts.over_budget, tone: 'warning', glyph: 'solid' },
    { v: 'flaky', label: dl.lcx6_filter_flaky, count: counts.flaky, tone: 'warning', glyph: 'hollow' },
  ];
  return (
    <div data-testid="lc6-gate-toolbar" data-sort={view.sort} data-filter={view.filter}>
      <Toolbar label={dl.lcx6_toolbar}>
        <Segmented label={dl.lcx6_sort} options={sorts} value={view.sort} onChange={(sort) => onChange({ ...view, sort })} />
        <Segmented label={dl.lcx6_filter} options={filters} value={view.filter} onChange={(filter) => onChange({ ...view, filter })} />
      </Toolbar>
    </div>
  );
}


// The estate's filter bar: one chip per status that has docs - its swatch is
// the estate cell's own shape, so the chips ARE the map's legend - pressed to
// show only those docs (several may be on); a path search ("/" focuses it, Esc
// in it clears it); how many docs the filter keeps; and the way back to all.
import { useRef } from 'react';
import { X } from 'lucide-react';

import { ChipView, KitButton, SearchField, Toolbar, type Chip } from '@/features/shared/components/kit';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { DOC_STATUSES } from '../docsModel';
import { DocSwatch, useDocStatusLabel } from './docWords';
import type { DocsView } from './useDocsView';

export function EstateToolbar({ view }: { view: DocsView }) {
  const { dl, tx } = useLifecycleViewModel();
  const label = useDocStatusLabel();
  const searchRef = useRef<HTMLInputElement>(null);

  useAppKeyboard((e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return false;
    e.preventDefault();
    searchRef.current?.focus();
    return true;
  }, { priority: ROUTE_DECISION_PRIORITY });

  const chips: Chip[] = DOC_STATUSES.filter((s) => view.counts[s] > 0).map((s) => ({
    id: s,
    label: <span className="inline-flex items-center gap-1.5" data-testid={`lcx7-chip-${s}`}><DocSwatch status={s} />{label(s)}</span>,
    count: view.counts[s],
    share: view.total > 0 ? view.counts[s] / view.total : 0,
    state: view.filter.statuses.has(s) ? 'selected' : 'default',
    onPress: () => view.toggleStatus(s),
  }));

  return (
    <Toolbar label={dl.lcx7_filter_label}>
      {/* Chips straight in the toolbar (a ChipRow brings its own gutter, which the toolbar already has). */}
      <div role="group" aria-label={dl.lcx7_filter_label} className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => <ChipView key={c.id} chip={c} />)}
      </div>
      <div
        className="min-w-0 flex-1 basis-56"
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !view.filter.query) return;
          e.preventDefault();
          e.stopPropagation();
          view.setQuery('');
        }}
      >
        <SearchField value={view.filter.query} onChange={view.setQuery} placeholder={dl.lcx7_search} inputRef={searchRef} testId="lcx7-search" />
      </div>
      {/* A live region stays mounted, so the count it announces is heard when a filter first applies. */}
      <span className={`${LT.meta} tabular-nums`} role="status" data-testid="lcx7-shown">
        {view.filtering ? tx(dl.lcx7_shown, { shown: view.shown, total: view.total }) : ''}
      </span>
      {view.filtering && (
        <KitButton tone="quiet" icon={<X className={GLYPH.sm} />} onClick={view.clearFilter} testId="lcx7-clear">
          {dl.lcx7_clear_filter}
        </KitButton>
      )}
    </Toolbar>
  );
}

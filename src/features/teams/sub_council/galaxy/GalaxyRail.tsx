// The docked list — the galaxy's keyboard and screen-reader path.
//
// Everything the canvas draws is reachable here: the same rank numbers, the
// same name order, the same council pips, and under council focus the same
// star set. Arrow keys and Enter are bound with the CONTAINMENT form (a
// handler on the listbox itself) rather than a global rank, because they
// belong to this one visible surface.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Search } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../councilStore';
import type { GalaxyEngine } from './engine/GalaxyEngine';
import type { GalaxyNode } from './engine/types';
import { RailList, type RailItem } from './rail/RailList';
import { RailPath, pathSteps } from './rail/RailPath';
import { useGalaxyRows, type RailRow } from './useGalaxyRows';

interface Props {
  engine: GalaxyEngine | null;
  filterRef: React.RefObject<HTMLInputElement | null>;
  describedById: string;
}

export function GalaxyRail({ engine, filterRef, describedById }: Props) {
  const { t, tx } = useTranslation();
  const g = t.council.galaxy;
  const listRef = useRef<HTMLDivElement | null>(null);

  const layout = useCouncilStore((s) => s.layout);
  const focus = useCouncilStore((s) => s.focus);
  const filter = useCouncilStore((s) => s.filter);
  const counts = useCouncilStore((s) => s.counts);
  const selectedIndex = useCouncilStore((s) => s.selectedIndex);
  const setFilter = useCouncilStore((s) => s.setFilter);
  const setSelectedIndex = useCouncilStore((s) => s.setSelectedIndex);
  const setHover = useCouncilStore((s) => s.setHover);

  const model = useGalaxyRows(layout, focus, filter);
  const steps = useMemo(
    () =>
      pathSteps(layout, focus, {
        field: g.level_field,
        allDomains: g.field_all_domains,
        council: g.level_council,
        domain: g.level_domain,
        category: g.level_category,
        subject: g.level_subject,
      }),
    [layout, focus, g],
  );

  const heading =
    model.level === 'council'
      ? tx(g.rows_heading_council, { count: model.rows.length })
      : tx(g[`rows_heading_${model.level}` as const], { count: model.rows.length });

  const items = useMemo<RailItem[]>(() => {
    const out: RailItem[] = [{ kind: 'heading', key: '__top', label: heading }];
    model.rows.forEach((row, index) => {
      if (row.groupKey !== null) {
        out.push({
          kind: 'heading',
          key: `group-${row.groupKey}`,
          label: tx(g.wedge_caption, {
            name: row.groupKey === '' ? g.no_subcategory : row.groupKey.replace(/-/g, ' '),
            count: row.groupCount,
          }),
        });
      }
      out.push({ kind: 'row', key: row.key, row, index });
    });
    return out;
  }, [model.rows, heading, g, tx]);

  const activate = useCallback(
    (row: RailRow, index: number) => {
      setSelectedIndex(index);
      if (!engine) return;
      // Inside a council the list never leaves the council's view: a row aims
      // the camera at its star and keeps the focus.
      if (focus.kind === 'council' || row.node.kind === 'technique') {
        setHover(row.node);
        engine.aimAt(row.node);
        return;
      }
      engine.descend(row.node);
    },
    [engine, focus.kind, setHover, setSelectedIndex],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const last = model.rows.length - 1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(Math.min(last, selectedIndex + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = model.rows[selectedIndex];
        if (row) activate(row, selectedIndex);
      }
    },
    [activate, model.rows, selectedIndex, setSelectedIndex],
  );

  // Moving the selection lights the same node on the canvas.
  useEffect(() => {
    const row = model.rows[selectedIndex];
    setHover((row?.node as GalaxyNode | undefined) ?? null);
  }, [model.rows, selectedIndex, setHover]);

  return (
    /* The rail is the SAME MATERIAL as the app's own level-2 side menu
       (`shared/chrome/sidebar/Sidebar.tsx:243-262`): a `bg-secondary/30`
       surface behind a `border-primary/15` hairline, with a `bg-primary/5`
       band under a `border-primary/10` rule. It used `bg-card-bg` /
       `border-card-border`, which is the recipe for a CARD sitting ON a
       surface — so the rail read as a card the app had parked beside the
       field rather than as the page's own furniture. */
    <aside className="flex w-[330px] flex-none flex-col border-r border-primary/15 bg-secondary/30" data-testid="council-rail">
      <div className="border-b border-primary/10 bg-primary/5 px-4 pb-2.5 pt-3.5">
        <RailPath steps={steps} />
        <div className="mt-2.5 flex items-center gap-2 rounded-input border border-primary/15 bg-secondary/40 px-2.5">
          <Search className="h-3.5 w-3.5 flex-none text-muted-dark" aria-hidden="true" />
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={g.filter_placeholder}
            aria-label={g.filter_placeholder}
            className="flex-1 bg-transparent py-2 typo-body text-foreground placeholder:text-muted-dark focus:outline-none"
            data-testid="council-rail-filter"
          />
        </div>
      </div>
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label={heading}
        id={describedById}
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-1 flex-col focus-visible:outline-none"
      >
        <RailList
          items={items}
          selectedIndex={selectedIndex}
          onSelect={activate}
          onHover={(row) => setHover(row?.node ?? null)}
        />
      </div>
      <div className="flex justify-between border-t border-primary/10 px-4 py-2 typo-caption">
        <span>
          <Numeric value={model.rows.length} /> {g.foot_shown}
        </span>
        <span>
          {counts.dimmed > 0 ? (
            <>
              <Numeric value={counts.dimmed} /> {g.foot_dimmed}
            </>
          ) : counts.labelsHidden > 0 ? (
            <>
              <Numeric value={counts.labelsHidden} /> {g.foot_labels_hidden}
            </>
          ) : null}
        </span>
      </div>
    </aside>
  );
}

export default GalaxyRail;

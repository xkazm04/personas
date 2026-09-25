import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ContextGroups, type ContextGroupRow } from './ContextGroups';
import { Crumbs } from './Crumbs';
import { Section } from './Section';
import type { EmptySpec } from './states';
import { SearchField, Toolbar } from './Toolbar';
import { kitAttrs } from './types';

/**
 * The most contexts level 2 shows as ContextCards. Twelve cards are two or three rows of tiles
 * at the kit's 240px minimum (four to six columns between 1280 and 1920), so the whole group is
 * on screen at once and a tile's extra room is worth it. Past that, tiles become a wall the eye
 * cannot compare across, and a DataTable (56px rows, figures in sortable columns) scans better.
 */
export const CARD_LEVEL_MAX = 12;

/** How level 2 draws a group of `n` contexts: tiles when few, a table when many. */
export function contextLevel(n: number): 'cards' | 'table' {
  return n <= CARD_LEVEL_MAX ? 'cards' : 'table';
}

/** How many search matches level 1 hands to `renderMatches` (the rest are counted, not mounted). */
export const MATCH_CAP = 50;

export interface ContextGroup<C> extends ContextGroupRow {
  contexts: readonly C[];
}

/**
 * ContextOverview: the parent layer a surface that can hold MANY contexts gets before any card.
 * Level 1 is ContextGroups (one row per group) under a search that reaches every context; a
 * query swaps the groups for the matches (at most MATCH_CAP mounted, the total passed along).
 * Opening a group is level 2: a level-2 Section named for the group with Crumbs back up, whose
 * body the caller renders as the `contextLevel` says (cards when it is small, a table when it is
 * large). Only one level is mounted at a time, so 300 contexts in 20 groups mount 20 rows, and a
 * group mounts only its own contexts. Navigation is the caller's (`open`, `query`), so it can
 * survive a remount; focus follows it (into level 2 on open, back to the group's row on return).
 * @catalog ContextOverview - parent layer over many contexts: groups + search, then one group as cards or a table. Kit.
 */
export function ContextOverview<C>({
  label, rootLabel, groups, open, onOpen, query, onQuery, searchPlaceholder, match, renderGroup, renderMatches,
  unitLabel, legend, figureHeads, toolbar, loading, empty,
}: {
  label: string;
  /** The level-1 crumb ("All contexts"). */
  rootLabel: string;
  groups: ReadonlyArray<ContextGroup<C>>;
  open: string | null;
  onOpen: (id: string | null) => void;
  query: string;
  onQuery: (q: string) => void;
  searchPlaceholder: string;
  match: (c: C, q: string) => boolean;
  renderGroup: (g: ContextGroup<C>, level: 'cards' | 'table') => ReactNode;
  /** Level 1 under a query: the first MATCH_CAP matches and how many there are in all. */
  renderMatches: (matches: readonly C[], total: number) => ReactNode;
  unitLabel: (g: ContextGroupRow) => string;
  legend?: (quantum: number) => ReactNode;
  figureHeads?: readonly string[];
  /** More level-1 controls after the search (a state filter). */
  toolbar?: ReactNode;
  loading?: boolean;
  empty: EmptySpec;
}) {
  const [back, setBack] = useState<string | null>(null);
  const entered = useRef(false);
  const level2 = useRef<HTMLDivElement>(null);
  const g = open ? groups.find((x) => x.id === open) : undefined;

  useEffect(() => {
    if (g && entered.current) level2.current?.querySelector<HTMLElement>('button.k-crumb')?.focus();
    entered.current = false;
  }, [g]);

  if (g) {
    return (
      <div ref={level2} className="k-overview" {...kitAttrs('ContextOverview', 'selected')}>
        <Section
          level={2}
          eyebrow={<Crumbs label={label} items={[{ label: rootLabel, onPress: () => { setBack(g.id); onOpen(null); } }]} />}
          title={g.name}
          count={g.count}
          meta={g.meta}
        >
          {renderGroup(g, contextLevel(g.contexts.length))}
        </Section>
      </div>
    );
  }

  const q = query.trim();
  let body: ReactNode;
  if (q) {
    const all = groups.flatMap((x) => x.contexts.filter((c) => match(c, q)));
    body = renderMatches(all.slice(0, MATCH_CAP), all.length);
  } else {
    body = (
      <ContextGroups
        groups={groups}
        label={label}
        unitLabel={unitLabel}
        legend={legend}
        figureHeads={figureHeads}
        focusId={back}
        loading={loading}
        empty={empty}
        onOpen={(id) => { entered.current = true; setBack(null); onOpen(id); }}
      />
    );
  }
  return (
    <div className="k-overview" {...kitAttrs('ContextOverview')}>
      <Toolbar label={label}>
        <SearchField value={query} onChange={onQuery} placeholder={searchPlaceholder} />
        {toolbar}
      </Toolbar>
      {body}
    </div>
  );
}

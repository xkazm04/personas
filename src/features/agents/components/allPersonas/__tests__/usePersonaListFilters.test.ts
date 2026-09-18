import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePersonaListFilters } from '../PersonaOverviewFilters';
import { DEFAULT_VIEW_CONFIG, type AgentListViewConfig } from '../viewConfig';
import type { Persona } from '@/lib/bindings/Persona';

interface Args {
  personas: Persona[];
  view?: Partial<AgentListViewConfig>;
  search?: string;
  groupFilter?: string | null;
  healthMap?: Record<string, { status: string } | undefined>;
  building?: Set<string>;
  favorites?: Set<string>;
}

function run({ personas, view = {}, search = '', groupFilter = null, healthMap = {}, building = new Set(), favorites = new Set() }: Args) {
  const { result } = renderHook(() =>
    usePersonaListFilters({
      personas,
      view: { ...DEFAULT_VIEW_CONFIG, sortKey: null, ...view },
      search,
      triggerCounts: {},
      lastRunMap: {},
      healthMap: healthMap as never,
      isBuilding: (id) => building.has(id),
      isDraft: (p) => p.lifecycle === 'draft',
      isArchived: (p) => p.lifecycle === 'archived',
      isFavorite: (id) => favorites.has(id),
      groupFilter,
    }),
  );
  return result.current;
}

function make(id: string, over: Partial<Record<string, unknown>> = {}): Persona {
  return {
    id,
    name: id,
    description: null,
    enabled: true,
    lifecycle: 'active',
    home_team_id: null,
    trust_score: 0,
    created_at: '2026-01-01T00:00:00Z',
    design_context: null,
    ...over,
  } as unknown as Persona;
}

describe('usePersonaListFilters', () => {
  it('hides archived personas from every non-archived view', () => {
    const { data } = run({ personas: [make('a'), make('b', { lifecycle: 'archived' })] });
    expect(data.map((p) => p.id)).toEqual(['a']);
  });

  it('shows only archived personas in the archived view', () => {
    const { data } = run({
      personas: [make('a'), make('b', { lifecycle: 'archived' })],
      view: { statusFilter: 'archived' },
    });
    expect(data.map((p) => p.id)).toEqual(['b']);
  });

  it('excludes drafts from the enabled filter but includes them under building', () => {
    const personas = [make('a'), make('d', { lifecycle: 'draft' }), make('off', { enabled: false })];
    expect(run({ personas, view: { statusFilter: 'enabled' } }).data.map((p) => p.id)).toEqual(['a']);
    expect(run({ personas, view: { statusFilter: 'building' } }).data.map((p) => p.id)).toEqual(['d']);
    expect(run({ personas, view: { statusFilter: 'disabled' } }).data.map((p) => p.id)).toEqual(['off']);
  });

  it('treats personas without a health entry as healthy for the health filter', () => {
    const personas = [make('h'), make('f')];
    const healthMap = { f: { status: 'failing' } };
    expect(run({ personas, healthMap, view: { healthFilter: 'healthy' } }).data.map((p) => p.id)).toEqual(['h']);
    expect(run({ personas, healthMap, view: { healthFilter: 'failing' } }).data.map((p) => p.id)).toEqual(['f']);
  });

  it('matches search against name and description, case-insensitively', () => {
    const personas = [make('a', { name: 'Mailer' }), make('b', { name: 'x', description: 'sends MAIL daily' }), make('c', { name: 'Scraper' })];
    const { data } = run({ personas, search: 'mail' });
    expect(data.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('applies the __ungrouped__ sentinel and team id group filters', () => {
    const personas = [make('t', { home_team_id: 'team-1' }), make('u')];
    expect(run({ personas, groupFilter: '__ungrouped__' }).data.map((p) => p.id)).toEqual(['u']);
    expect(run({ personas, groupFilter: 'team-1' }).data.map((p) => p.id)).toEqual(['t']);
    expect(run({ personas, groupFilter: null }).data.map((p) => p.id)).toEqual(['t', 'u']);
  });

  it('filters to favorites only', () => {
    const personas = [make('fav'), make('plain')];
    const { data } = run({ personas, view: { favoriteOnly: true }, favorites: new Set(['fav']) });
    expect(data.map((p) => p.id)).toEqual(['fav']);
  });

  it('sorts by name and respects direction', () => {
    const personas = [make('b', { name: 'Bravo' }), make('a', { name: 'Alpha' })];
    expect(run({ personas, view: { sortKey: 'name', sortDirection: 'asc' } }).data.map((p) => p.name)).toEqual(['Alpha', 'Bravo']);
    expect(run({ personas, view: { sortKey: 'name', sortDirection: 'desc' } }).data.map((p) => p.name)).toEqual(['Bravo', 'Alpha']);
  });

  it('sorts by trust score numerically', () => {
    const personas = [make('lo', { trust_score: 10 }), make('hi', { trust_score: 90 })];
    const { data } = run({ personas, view: { sortKey: 'trust', sortDirection: 'desc' } });
    expect(data.map((p) => p.id)).toEqual(['hi', 'lo']);
  });

  it('builds a connector-names map entry for every persona', () => {
    const result = run({ personas: [make('a'), make('b')] });
    expect([...result.connectorNamesMap.keys()].sort()).toEqual(['a', 'b']);
    expect(result.allConnectorNames).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// sweep #113 — the roster can be ranked by money. Until this column existed the
// only cost figure in the app was inside one agent's editor, so "which agent is
// expensive" meant opening them one at a time.
// --------------------------------------------------------------------------

function spend(entries: Record<string, number>): Map<string, { spend: number }> {
  return new Map(Object.entries(entries).map(([id, v]) => [id, { spend: v }]));
}

describe('usePersonaListFilters: spend sort', () => {
  it('ranks the expensive agents last ascending, first descending', () => {
    const personas = [make('cheap'), make('dear'), make('middling')];
    const spendMap = spend({ cheap: 0.4, dear: 12.5, middling: 3 });

    const asc = renderHook(() =>
      usePersonaListFilters({
        personas,
        view: { ...DEFAULT_VIEW_CONFIG, sortKey: 'spend', sortDirection: 'asc' },
        search: '',
        triggerCounts: {},
        lastRunMap: {},
        spendMap,
        healthMap: {} as never,
        isBuilding: () => false,
        isDraft: () => false,
        isArchived: () => false,
        isFavorite: () => false,
        groupFilter: null,
      }),
    );
    expect(asc.result.current.data.map((p) => p.id)).toEqual(['cheap', 'middling', 'dear']);

    const desc = renderHook(() =>
      usePersonaListFilters({
        personas,
        view: { ...DEFAULT_VIEW_CONFIG, sortKey: 'spend', sortDirection: 'desc' },
        search: '',
        triggerCounts: {},
        lastRunMap: {},
        spendMap,
        healthMap: {} as never,
        isBuilding: () => false,
        isDraft: () => false,
        isArchived: () => false,
        isFavorite: () => false,
        groupFilter: null,
      }),
    );
    expect(desc.result.current.data.map((p) => p.id)).toEqual(['dear', 'middling', 'cheap']);
  });

  it('never ranks an unreported figure as if it were free', () => {
    // Unknown and $0 are different facts. Defaulting the missing one to zero
    // would put the agent nobody could measure at the cheap end of the list.
    const personas = [make('unknown'), make('dear'), make('free')];
    const spendMap = spend({ dear: 9, free: 0 });
    const order = (direction: 'asc' | 'desc') =>
      renderHook(() =>
        usePersonaListFilters({
          personas,
          view: { ...DEFAULT_VIEW_CONFIG, sortKey: 'spend', sortDirection: direction },
          search: '',
          triggerCounts: {},
          lastRunMap: {},
          spendMap,
          healthMap: {} as never,
          isBuilding: () => false,
          isDraft: () => false,
          isArchived: () => false,
          isFavorite: () => false,
          groupFilter: null,
        }),
      ).result.current.data.map((p) => p.id);

    // Present in both directions, and last in both - the column says "no
    // figure", the ordering never pretends to know one.
    expect(order('asc')).toEqual(['free', 'dear', 'unknown']);
    expect(order('desc')).toEqual(['dear', 'free', 'unknown']);
  });

  it('leaves the order alone when no spend map is supplied at all', () => {
    const { data } = run({ personas: [make('a'), make('b')], view: { sortKey: 'spend' } });
    expect(data.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

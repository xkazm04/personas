import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW_CONFIG, hasActiveFilters } from '../viewConfig';

describe('hasActiveFilters', () => {
  it('is false for the default view with no search and no team', () => {
    expect(hasActiveFilters(DEFAULT_VIEW_CONFIG, '', null)).toBe(false);
    expect(hasActiveFilters(DEFAULT_VIEW_CONFIG, '   ', null)).toBe(false);
  });

  it('is true for each view field that narrows the roster', () => {
    expect(hasActiveFilters({ ...DEFAULT_VIEW_CONFIG, statusFilter: 'archived' }, '', null)).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_VIEW_CONFIG, healthFilter: 'failing' }, '', null)).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_VIEW_CONFIG, connectorFilter: 'slack' }, '', null)).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_VIEW_CONFIG, favoriteOnly: true }, '', null)).toBe(true);
    expect(hasActiveFilters(DEFAULT_VIEW_CONFIG, 'mail', null)).toBe(true);
  });

  it('counts the team dropdown as a filter, including the no-team sentinel', () => {
    // The rail is the one filter that lives outside AgentListViewConfig; the
    // inline check in the page used to omit it.
    expect(hasActiveFilters(DEFAULT_VIEW_CONFIG, '', 'team-1')).toBe(true);
    expect(hasActiveFilters(DEFAULT_VIEW_CONFIG, '', '__ungrouped__')).toBe(true);
  });

  it('does not treat the sort as a filter', () => {
    expect(hasActiveFilters({ ...DEFAULT_VIEW_CONFIG, sortKey: 'name', sortDirection: 'asc' }, '', null)).toBe(false);
  });
});

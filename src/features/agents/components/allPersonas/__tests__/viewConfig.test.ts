import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW_CONFIG, hasActiveListFilter } from '../viewConfig';

describe('hasActiveListFilter', () => {
  it('is false for the default view with no search and no team filter', () => {
    expect(hasActiveListFilter(DEFAULT_VIEW_CONFIG, '', null)).toBe(false);
  });

  it('is true for each view-config filter', () => {
    expect(hasActiveListFilter({ ...DEFAULT_VIEW_CONFIG, statusFilter: 'enabled' }, '', null)).toBe(true);
    expect(hasActiveListFilter({ ...DEFAULT_VIEW_CONFIG, healthFilter: 'failing' }, '', null)).toBe(true);
    expect(hasActiveListFilter({ ...DEFAULT_VIEW_CONFIG, connectorFilter: 'slack' }, '', null)).toBe(true);
    expect(hasActiveListFilter({ ...DEFAULT_VIEW_CONFIG, favoriteOnly: true }, '', null)).toBe(true);
  });

  it('is true for a non-blank search', () => {
    expect(hasActiveListFilter(DEFAULT_VIEW_CONFIG, '  ', null)).toBe(false);
    expect(hasActiveListFilter(DEFAULT_VIEW_CONFIG, ' bot ', null)).toBe(true);
  });

  it('counts the home-team filter, which the filter pipeline applies but the page never asked about', () => {
    // usePersonaListFilters narrows on groupFilter (PersonaOverviewFilters.tsx:162-166),
    // but the page's own hasActiveFilter did not, so filtering to a team with no
    // members rendered an empty grid instead of the "no match / reset" empty state,
    // and Reset filters could not clear it.
    expect(hasActiveListFilter(DEFAULT_VIEW_CONFIG, '', 'team-1')).toBe(true);
    expect(hasActiveListFilter(DEFAULT_VIEW_CONFIG, '', '__ungrouped__')).toBe(true);
  });
});

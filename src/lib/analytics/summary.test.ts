import { describe, it, expect } from 'vitest';
import { SECTIONS, TAB_DIMENSIONS } from './navCatalog';
import { buildSessionSummary, sectionCountKey, tabCountKey } from './summary';

describe('navCatalog invariants', () => {
  it('has unique tab-dimension keys', () => {
    const keys = TAB_DIMENSIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every dimension has a non-empty value set with unique values', () => {
    for (const dim of TAB_DIMENSIONS) {
      expect(dim.values.length).toBeGreaterThan(0);
      expect(new Set(dim.values).size).toBe(dim.values.length);
    }
  });

  it('every dimension is attributed to a known section', () => {
    for (const dim of TAB_DIMENSIONS) {
      expect(SECTIONS).toContain(dim.section);
    }
  });

  it('produces collision-free count keys even when dimensions share a value', () => {
    // editorTab and designSubTab both have "use-cases" under the personas section.
    expect(tabCountKey('editorTab', 'use-cases')).not.toBe(tabCountKey('designSubTab', 'use-cases'));
  });
});

describe('buildSessionSummary', () => {
  it('reports everything as ignored for an empty session', () => {
    const s = buildSessionSummary({});
    expect(s.totalVisits).toBe(0);
    expect(s.sectionsVisited).toEqual([]);
    expect(s.sectionsIgnored).toEqual([...SECTIONS]);
    expect(s.sectionsTotal).toBe(SECTIONS.length);
    expect(s.tabsVisited).toEqual([]);
    expect(s.tabsIgnored.length).toBe(s.tabsTotal);
    expect(s.tabsTotal).toBeGreaterThan(0);
  });

  it('splits visited vs ignored from real counts', () => {
    const counts = {
      [sectionCountKey('overview')]: 3,
      [sectionCountKey('settings')]: 1,
      [tabCountKey('overviewTab', 'incidents')]: 2,
      [tabCountKey('settingsTab', 'account')]: 1,
    };
    const s = buildSessionSummary(counts);

    expect(s.totalVisits).toBe(7);
    expect(s.sectionsVisited.sort()).toEqual(['overview', 'settings']);
    expect(s.sectionsIgnored).toContain('home');
    expect(s.sectionsIgnored).not.toContain('overview');

    expect(s.tabsVisited).toContain(tabCountKey('overviewTab', 'incidents'));
    expect(s.tabsVisited).toContain(tabCountKey('settingsTab', 'account'));
    expect(s.tabsIgnored).toContain(tabCountKey('overviewTab', 'health'));
    expect(s.tabsVisited.length + s.tabsIgnored.length).toBe(s.tabsTotal);
  });

  it('does not let a tab value collide with a same-named section', () => {
    // OverviewTab has a value "home", and "home" is also a section. They must
    // be counted independently (bare key vs dimension-keyed).
    const counts = { [tabCountKey('overviewTab', 'home')]: 5 };
    const s = buildSessionSummary(counts);
    expect(s.sectionsVisited).not.toContain('home'); // the section was never visited
    expect(s.tabsVisited).toContain(tabCountKey('overviewTab', 'home'));
  });
});

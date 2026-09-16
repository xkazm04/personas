import { describe, expect, it } from 'vitest';

import {
  activeTabOf,
  adoptSite,
  adoptSites,
  adoptTabs,
  dropSite,
  hasRunningScan,
  type BrowserSnapshot,
} from '../browserStore';
import type { BrowserSite, BrowserTab } from '../types';

const EMPTY: BrowserSnapshot = {
  sites: [],
  sitesLoading: false,
  sitesLoaded: false,
  tabs: [],
  tabsLoading: true,
  activeTabId: null,
};

function tab(id: number, patch: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id,
    url: `https://example${id}.com/`,
    title: `Tab ${id}`,
    origin: `https://example${id}.com`,
    focused: false,
    lease: null,
    can_go_back: false,
    can_go_forward: false,
    ...patch,
  };
}

function site(origin: string, patch: Partial<BrowserSite> = {}): BrowserSite {
  return {
    origin,
    label: origin,
    enabled: false,
    overrides: {},
    budget: 50,
    credential_id: null,
    scan_status: 'none',
    scan_tier: null,
    scan_report: null,
    scan_at: null,
    first_seen: 0,
    last_seen: 0,
    created_by: 'operator',
    ...patch,
  } as BrowserSite;
}

describe('adoptTabs', () => {
  it("follows Rust's focused tab, because the page host IS that tab", () => {
    const next = adoptTabs({ ...EMPTY, activeTabId: 1 }, [tab(1), tab(2, { focused: true })]);
    expect(next.activeTabId).toBe(2);
  });

  it('keeps the current tab when Rust names no focused one', () => {
    const next = adoptTabs({ ...EMPTY, activeTabId: 2 }, [tab(1), tab(2)]);
    expect(next.activeTabId).toBe(2);
  });

  it('falls back to the first tab when the active one is gone', () => {
    const next = adoptTabs({ ...EMPTY, activeTabId: 9 }, [tab(1), tab(2)]);
    expect(next.activeTabId).toBe(1);
  });

  it('clears the active tab when the last one closes', () => {
    const next = adoptTabs({ ...EMPTY, activeTabId: 1 }, []);
    expect(next.activeTabId).toBeNull();
    expect(next.tabsLoading).toBe(false);
  });

  it('resolves the active tab object', () => {
    const next = adoptTabs(EMPTY, [tab(1), tab(2, { focused: true })]);
    expect(activeTabOf(next)?.id).toBe(2);
  });
});

describe('adoptSite / dropSite', () => {
  it('replaces a known row in place rather than appending a duplicate', () => {
    const base = adoptSites(EMPTY, [site('https://a.com'), site('https://b.com')]);
    const next = adoptSite(base, site('https://a.com', { enabled: true }));
    expect(next.sites).toHaveLength(2);
    expect(next.sites.find((s) => s.origin === 'https://a.com')?.enabled).toBe(true);
  });

  it('inserts an unknown row in origin order', () => {
    const base = adoptSites(EMPTY, [site('https://b.com')]);
    const next = adoptSite(base, site('https://a.com'));
    expect(next.sites.map((s) => s.origin)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('drops exactly the named origin', () => {
    const base = adoptSites(EMPTY, [site('https://a.com'), site('https://b.com')]);
    expect(dropSite(base, 'https://a.com').sites.map((s) => s.origin)).toEqual(['https://b.com']);
  });

  it('marks the first load settled so the empty state may show', () => {
    const next = adoptSites(EMPTY, []);
    expect(next.sitesLoaded).toBe(true);
    expect(next.sitesLoading).toBe(false);
  });
});

describe('hasRunningScan', () => {
  it('is what turns the poll on and off', () => {
    expect(hasRunningScan([site('https://a.com')])).toBe(false);
    expect(hasRunningScan([site('https://a.com', { scan_status: 'running' })])).toBe(true);
    expect(hasRunningScan([site('https://a.com', { scan_status: 'proposed' })])).toBe(false);
  });
});

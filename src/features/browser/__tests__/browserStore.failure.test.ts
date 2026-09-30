/**
 * A failed list is not a successful empty load. The first tab fetch that
 * rejects must raise tabsError and leave tabsLoading false without inventing
 * an empty success. The site list must stay unloaded (sitesLoaded false) so
 * the next refresh is still a first load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserTab } from '../types';

vi.mock('@/api/browser', () => ({
  listSites: vi.fn(),
  listTabs: vi.fn(),
  listenTabs: vi.fn(),
  listenScan: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/silentCatch')>('@/lib/silentCatch');
  return { ...actual, silentCatch: () => () => undefined };
});

import * as browserApi from '@/api/browser';

import { browserSnapshot, refreshSites, refreshTabs, resetBrowserStore } from '../browserStore';

const listTabs = vi.mocked(browserApi.listTabs);
const listSites = vi.mocked(browserApi.listSites);
const listenTabs = vi.mocked(browserApi.listenTabs);

function tab(id: number): BrowserTab {
  return {
    id,
    url: `https://example${id}.com/`,
    title: `Tab ${id}`,
    origin: `https://example${id}.com`,
    focused: true,
    lease: null,
    can_go_back: false,
    can_go_forward: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listenTabs.mockImplementation(() => Promise.resolve(() => undefined));
  resetBrowserStore();
});

afterEach(() => {
  resetBrowserStore();
});

describe('failed lists', () => {
  it('records a tab-list failure instead of an empty success', async () => {
    listTabs.mockRejectedValueOnce({ error: 'there is no tab backend', kind: 'validation' });
    await refreshTabs();
    const snap = browserSnapshot();
    expect(snap.tabs).toEqual([]);
    expect(snap.tabsLoading).toBe(false);
    expect(snap.tabsError).toBe('there is no tab backend');
  });

  it('a later successful tab list clears the error', async () => {
    listTabs.mockRejectedValueOnce(new Error('offline'));
    await refreshTabs();
    listTabs.mockResolvedValueOnce([tab(3)]);
    await refreshTabs();
    const snap = browserSnapshot();
    expect(snap.tabs.map((row) => row.id)).toEqual([3]);
    expect(snap.tabsError).toBeNull();
    expect(snap.tabsLoading).toBe(false);
  });

  it('a failed site list stays unloaded and keeps the error', async () => {
    listSites.mockRejectedValueOnce({ error: 'database is locked', kind: 'execution' });
    await refreshSites();
    const snap = browserSnapshot();
    expect(snap.sites).toEqual([]);
    expect(snap.sitesLoading).toBe(false);
    expect(snap.sitesLoaded).toBe(false);
    expect(snap.sitesError).toBe('database is locked');
  });

  it('a later successful site list clears the error and settles the load', async () => {
    listSites.mockRejectedValueOnce(new Error('offline'));
    await refreshSites();
    listSites.mockResolvedValueOnce([]);
    await refreshSites();
    const snap = browserSnapshot();
    expect(snap.sitesLoaded).toBe(true);
    expect(snap.sitesError).toBeNull();
    expect(snap.sitesLoading).toBe(false);
  });
});

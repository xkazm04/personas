/**
 * The list/event race. A `browser_webview_list` that was in flight when a
 * newer `browser-tabs` event (or a newer list) arrived must not paint over it.
 * Same rule for `browser_sites_list` against `putSite`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserSite, BrowserTab } from '../types';

vi.mock('@/api/browser', () => ({
  listSites: vi.fn(),
  listTabs: vi.fn(),
  listenTabs: vi.fn(),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
}));

import * as browserApi from '@/api/browser';

import {
  browserSnapshot,
  initTabs,
  putSite,
  refreshSites,
  refreshTabs,
  resetBrowserStore,
} from '../browserStore';

const listTabs = vi.mocked(browserApi.listTabs);
const listSites = vi.mocked(browserApi.listSites);
const listenTabs = vi.mocked(browserApi.listenTabs);

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

function site(origin: string): BrowserSite {
  return {
    origin,
    label: origin,
    enabled: true,
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
  } as BrowserSite;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  listenTabs.mockImplementation(() => Promise.resolve(() => undefined));
  resetBrowserStore();
});

afterEach(() => {
  resetBrowserStore();
});

describe('tab list freshness', () => {
  it('a browser-tabs event during listTabs wins over the stale list', async () => {
    const listed = deferred<BrowserTab[]>();
    let handler: ((tabs: BrowserTab[]) => void) | null = null;
    listTabs.mockImplementationOnce(() => listed.promise);
    listenTabs.mockImplementationOnce((next) => {
      handler = next;
      return Promise.resolve(() => undefined);
    });

    const pending = initTabs();
    handler?.([tab(2, { focused: true })]);
    listed.resolve([tab(1, { focused: true })]);
    await pending;

    expect(browserSnapshot().tabs.map((row) => row.id)).toEqual([2]);
    expect(browserSnapshot().activeTabId).toBe(2);
  });

  it('an older refreshTabs does not overwrite a newer one', async () => {
    const older = deferred<BrowserTab[]>();
    const newer = deferred<BrowserTab[]>();
    listTabs.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);

    const first = refreshTabs();
    const second = refreshTabs();
    newer.resolve([tab(2, { focused: true })]);
    older.resolve([tab(1, { focused: true })]);
    await Promise.all([first, second]);

    expect(browserSnapshot().tabs.map((row) => row.id)).toEqual([2]);
  });

  it('subscribes again after listenTabs rejects', async () => {
    listTabs.mockResolvedValue([]);
    listenTabs.mockRejectedValueOnce(new Error('listen failed'));
    await initTabs();
    await initTabs();
    expect(listenTabs).toHaveBeenCalledTimes(2);
  });

  it('a list that resolves after reset does not repaint the store', async () => {
    const listed = deferred<BrowserTab[]>();
    listTabs.mockImplementationOnce(() => listed.promise);
    const pending = refreshTabs();
    resetBrowserStore();
    listed.resolve([tab(1, { focused: true })]);
    await pending;
    expect(browserSnapshot().tabs).toEqual([]);
  });
});

describe('site list freshness', () => {
  it('putSite during listSites wins over the stale list', async () => {
    const listed = deferred<BrowserSite[]>();
    listSites.mockImplementationOnce(() => listed.promise);
    const pending = refreshSites();
    putSite(site('https://kept.example'));
    listed.resolve([site('https://stale.example')]);
    await pending;
    expect(browserSnapshot().sites.map((row) => row.origin)).toEqual(['https://kept.example']);
  });
});

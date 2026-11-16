/**
 * Feeds ship with the app and are seeded on startup, so "No shared event feeds
 * available yet, click Refresh to fetch them from the cloud" sends someone whose
 * local read failed after a cloud problem that is not the cause. A failed read is
 * now stated with a Retry of the local read; a true empty keeps today's copy.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import enCommon from '@/i18n/section-locales/en/common.json';
import enTriggers from '@/i18n/section-locales/en/triggers.json';

const api = vi.hoisted(() => ({
  browseCatalog: vi.fn(),
  listSubscriptions: vi.fn(),
  changeActivity: vi.fn(),
  listProjectRoutes: vi.fn(),
  refreshCatalog: vi.fn(),
  subscribeFeed: vi.fn(),
  unsubscribeFeed: vi.fn(),
}));
vi.mock('@/api/events/sharedEvents', () => api);

import { SharedEventsTab } from '../SharedEventsTab';

const REASON = 'Feed catalog row is unreadable';
const REJECTION = { error: REASON, kind: 'Database' };
const FEED = {
  id: 'c1', slug: 'stripe-api', name: 'Stripe API changes', category: 'payments',
  description: null, icon: null, color: null, publisher: null, sourceUrl: null,
};

const findBanner = async () => {
  await screen.findByText(REASON);
  return screen.getByRole('alert');
};
const expectNoEmptyClaim = () => {
  expect(screen.queryByText(enTriggers.no_feeds)).toBeNull();
  expect(screen.queryByText(enTriggers.no_feeds_hint)).toBeNull();
};

describe('SharedEventsTab failed read', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.browseCatalog.mockResolvedValue([]);
    api.listSubscriptions.mockResolvedValue([]);
    api.changeActivity.mockResolvedValue([]);
    api.listProjectRoutes.mockResolvedValue([]);
    api.refreshCatalog.mockResolvedValue(undefined);
  });

  it('a failed catalog read states the rejection with a Retry and claims no empty list', async () => {
    api.browseCatalog.mockRejectedValue(REJECTION);
    render(<SharedEventsTab />);

    const banner = await findBanner();
    expect(within(banner).getByRole('button', { name: enCommon.retry })).toBeInTheDocument();
    expectNoEmptyClaim();
  });

  it('Retry repeats the local read, not the cloud refresh; success clears the banner', async () => {
    api.browseCatalog.mockRejectedValueOnce(REJECTION);
    render(<SharedEventsTab />);
    const banner = await findBanner();
    expect(api.browseCatalog).toHaveBeenCalledTimes(1);

    api.browseCatalog.mockResolvedValueOnce([FEED]);
    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    await waitFor(() => expect(api.browseCatalog).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(FEED.name)).toBeInTheDocument();
    expect(screen.queryByText(REASON)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.refreshCatalog).not.toHaveBeenCalled();
  });

  it('a Retry that succeeds with no feeds ends on the true empty copy', async () => {
    api.browseCatalog.mockRejectedValueOnce(REJECTION);
    render(<SharedEventsTab />);
    const banner = await findBanner();

    api.browseCatalog.mockResolvedValueOnce([]);
    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    expect(await screen.findByText(enTriggers.no_feeds)).toBeInTheDocument();
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('a failed subscriptions read is stated too, and the feeds stay listed', async () => {
    api.browseCatalog.mockResolvedValue([FEED]);
    api.listSubscriptions.mockRejectedValueOnce(REJECTION);
    render(<SharedEventsTab />);

    const banner = await findBanner();
    expect(await screen.findByText(FEED.name)).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    await waitFor(() => expect(api.listSubscriptions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(REASON)).toBeNull());
    expect(screen.getByText(FEED.name)).toBeInTheDocument();
  });

  it('a failed subscriptions read over an empty catalog does not claim no feeds', async () => {
    api.listSubscriptions.mockRejectedValue(REJECTION);
    render(<SharedEventsTab />);

    await findBanner();
    expectNoEmptyClaim();
  });

  it('a true empty keeps the no-feeds copy and no banner', async () => {
    render(<SharedEventsTab />);

    expect(await screen.findByText(enTriggers.no_feeds)).toBeInTheDocument();
    expect(screen.getByText(enTriggers.no_feeds_hint)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

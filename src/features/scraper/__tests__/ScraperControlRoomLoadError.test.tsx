import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { ScraperConfig } from '@/api/scraper';
import { ScraperControlRoom } from '../ScraperControlRoom';

// `useScraperData` recorded a failed load in `error` and nothing read it, so
// a refused read rendered "No scrapes yet". In a build without the `scraper`
// cargo feature every read is refused, so that lie was the whole page.

const NOT_ENABLED = { error: 'The local scraper is not enabled in this build.', kind: 'Internal' };

function data(over: Partial<Parameters<typeof ScraperControlRoom>[0]['data']> = {}) {
  return {
    configs: [],
    datasets: [],
    loading: false,
    error: null,
    runningId: null,
    reload: vi.fn(async () => undefined),
    save: vi.fn(),
    run: vi.fn(),
    remove: vi.fn(),
    queryDataset: vi.fn(),
    ...over,
  } as Parameters<typeof ScraperControlRoom>[0]['data'];
}

const CONFIG: ScraperConfig = {
  id: 'c1', name: 'Price watch', description: null, urls: ['https://example.com'], rules: {},
  dataset: 'prices', keyField: null, cron: null, enabled: false, nextRunAt: null, lastRunAt: null,
  lastStatus: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

describe('Control Room load failure', () => {
  it('says the load failed, with the reason, instead of "No scrapes yet"', () => {
    const d = data({ error: NOT_ENABLED });
    render(<ScraperControlRoom data={d} onNew={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByText(/not enabled in this build/)).toBeTruthy();
    expect(screen.queryByText(/No scrapes yet/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps rows already on screen under the banner', () => {
    render(<ScraperControlRoom data={data({ error: NOT_ENABLED, configs: [CONFIG] })} onNew={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByText('Price watch')).toBeTruthy();
    expect(screen.getByText(/not enabled in this build/)).toBeTruthy();
  });

  it('still shows the settled-empty state when the load succeeded', () => {
    render(<ScraperControlRoom data={data()} onNew={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText(/No scrapes yet/)).toBeTruthy();
  });
});

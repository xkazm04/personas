import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { DatasetRecord } from '@/api/scraper';
import { ScraperControlRoom } from '../ScraperControlRoom';

// `queryDataset` was wired in the data hook with zero UI consumers: the chips
// were dead counts. These cases pin the handoff — a chip opens the records,
// the Changed-only toggle re-queries with the flag the API already has, and a
// failed read never renders as an empty dataset.

const queryDataset = vi.fn<(name: string, changedOnly?: boolean) => Promise<DatasetRecord[] | null>>();

function record(key: string): DatasetRecord {
  return {
    key,
    data: { title: `Row ${key}` },
    firstSeen: '2026-09-17T08:00:00Z',
    lastSeen: '2026-09-17T09:00:00Z',
    updatedAt: '2026-09-17T09:00:00Z',
  };
}

function data() {
  return {
    configs: [],
    datasets: [{ name: 'jobs', count: 2 }],
    loading: false,
    error: null,
    runningId: null,
    reload: vi.fn(),
    save: vi.fn(),
    run: vi.fn(),
    remove: vi.fn(),
    queryDataset,
  } as unknown as Parameters<typeof ScraperControlRoom>[0]['data'];
}

beforeEach(() => {
  vi.clearAllMocks();
  queryDataset.mockResolvedValue([record('a'), record('b')]);
});

describe('Control Room dataset chips', () => {
  it('opens the records behind a chip', async () => {
    render(<ScraperControlRoom data={data()} onNew={vi.fn()} onEdit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /jobs/i }));

    await waitFor(() => expect(queryDataset).toHaveBeenCalledWith('jobs', false));
    expect(await screen.findByText(/title: Row a/)).toBeTruthy();
  });

  it('re-queries with the changed-only flag', async () => {
    render(<ScraperControlRoom data={data()} onNew={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /jobs/i }));
    await waitFor(() => expect(queryDataset).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('switch', { name: /changed only/i }));

    await waitFor(() => expect(queryDataset).toHaveBeenLastCalledWith('jobs', true));
  });

  it('does not render a failed read as an empty dataset', async () => {
    queryDataset.mockResolvedValue(null);
    render(<ScraperControlRoom data={data()} onNew={vi.fn()} onEdit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /jobs/i }));

    expect(await screen.findByText(/could not read this dataset/i)).toBeTruthy();
    expect(screen.queryByText(/no records stored yet/i)).toBeNull();
  });
});

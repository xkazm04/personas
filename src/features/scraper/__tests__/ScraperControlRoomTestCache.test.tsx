import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { PreviewRow, ScraperConfig } from '@/api/scraper';
import { ScraperControlRoom } from '../ScraperControlRoom';

// A row's Test (dry run) cached its first result forever: the row keeps its
// key across a save, so after editing the selectors, Test re-showed the OLD
// rules' harvest as if it were the new one.

const preview = vi.hoisted(() => vi.fn<(...a: unknown[]) => Promise<PreviewRow[]>>());
vi.mock('@/api/scraper', () => ({ previewScraperExtract: preview }));

function config(selector: string): ScraperConfig {
  return {
    id: 'c1', name: 'Price watch', description: null, urls: ['https://example.com'],
    rules: { price: { type: 'css', selector } }, dataset: 'prices', keyField: null, cron: null,
    enabled: false, nextRunAt: null, lastRunAt: null, lastStatus: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
}

function data(c: ScraperConfig) {
  return {
    configs: [c], datasets: [], loading: false, error: null, runningId: null,
    reload: vi.fn(), save: vi.fn(), run: vi.fn(), remove: vi.fn(), queryDataset: vi.fn(),
  } as unknown as Parameters<typeof ScraperControlRoom>[0]['data'];
}

const ROW: PreviewRow = { url: 'https://example.com', record: { price: '9' }, error: null, bytes: 1024 };

beforeEach(() => {
  preview.mockReset();
  preview.mockResolvedValue([ROW]);
});

function toggleTest() {
  fireEvent.click(screen.getByRole('button', { name: /test/i }));
}

describe('Control Room row Test', () => {
  it('re-runs the dry run after the rules changed', async () => {
    const { rerender } = render(<ScraperControlRoom data={data(config('.old'))} onNew={vi.fn()} onEdit={vi.fn()} />);
    toggleTest();
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await screen.findByText(/KB fetched/);
    toggleTest(); // close
    await waitFor(() => expect(screen.queryByText(/KB fetched/)).toBeNull());

    rerender(<ScraperControlRoom data={data(config('.new'))} onNew={vi.fn()} onEdit={vi.fn()} />);
    toggleTest();

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(preview.mock.calls[1]![1]).toEqual({ price: { type: 'css', selector: '.new' } });
  });

  it('reuses the result while the rules are unchanged', async () => {
    render(<ScraperControlRoom data={data(config('.same'))} onNew={vi.fn()} onEdit={vi.fn()} />);
    toggleTest();
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await screen.findByText(/KB fetched/);
    toggleTest();
    toggleTest();
    await new Promise((r) => setTimeout(r, 0));
    expect(preview).toHaveBeenCalledTimes(1);
  });
});

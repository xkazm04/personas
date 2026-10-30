import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  return { useTranslation: () => ({ t: en, tx: (s: string) => s }) };
});

import { DataGrid } from '../DataGrid';

type Row = { id: string };
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}` }));
const columns = [{ key: 'id', label: 'Id', width: '1fr', render: (r: Row) => <span>{r.id}</span> }];

// The roster scopes its header select-all to the page on screen (round 2
// card 14), so the grid reports which rows that page holds.
describe('DataGrid onPageRowsChange', () => {
  it('reports the rows of the page on screen, and follows a page change', () => {
    const onPageRowsChange = vi.fn();
    render(<DataGrid columns={columns} data={rows} getRowKey={(r) => r.id} pageSize={25} onPageRowsChange={onPageRowsChange} />);
    expect(onPageRowsChange.mock.lastCall?.[0]).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageRowsChange.mock.lastCall?.[0].map((r: Row) => r.id)).toEqual(['r25', 'r26', 'r27', 'r28', 'r29']);
  });
});

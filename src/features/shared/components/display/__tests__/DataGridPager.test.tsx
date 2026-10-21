import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Real English catalog as `t` so the pager resolves genuine copy.
vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  return { useTranslation: () => ({ t: en, tx: (s: string) => s }) };
});

import { DataGridPager } from '../DataGridPager';

const base = { pageSize: 25, pageSizeOptions: [10, 25, 50], total: 100, totalPages: 4, onPageSize: () => {} };

describe('DataGridPager', () => {
  it('names the icon-only previous and next buttons', () => {
    const onPage = vi.fn();
    render(<DataGridPager {...base} page={2} onPage={onPage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPage).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenLastCalledWith(3);
  });
});

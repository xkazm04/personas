import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: en,
    tx: (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? ''),
    language: 'en',
  }),
}));

import { FilterChips } from '../filters/FilterChips';
import { SearchChipInput } from '../suggestions/SearchChipInput';

describe('filter chip remove controls', () => {
  it('every chip X on the filter row is announced with the filter it removes', () => {
    render(
      <FilterChips
        selectedCategory="communication"
        connectorFilter={['slack']}
        onCategoryFilterChange={vi.fn()}
        onConnectorFilterChange={vi.fn()}
      />,
    );
    const unnamed = screen.getAllByRole('button').filter((b) => !b.getAttribute('aria-label') && !(b.textContent ?? '').trim());
    expect(unnamed).toEqual([]);
    expect(screen.getByRole('button', { name: 'Remove Communication filter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Slack filter' })).toBeTruthy();
  });

  it('the search input chip X reads from the locale, not an English literal', () => {
    const Input = SearchChipInput as unknown as (p: Record<string, unknown>) => JSX.Element;
    render(
      <Input chips={[{ type: 'difficulty', value: 'beginner', label: 'Beginner' }]} inputValue="" setInputValue={vi.fn()}
        removeChip={vi.fn()} addChip={vi.fn()} clearAll={vi.fn()} autocompletePrefix={null} autocompleteQuery=""
        availableCategories={[]} />,
    );
    expect(en.templates.search.remove_filter_aria).toBe('Remove {label} filter');
    expect(screen.getByRole('button', { name: 'Remove Beginner filter' })).toBeTruthy();
  });
});

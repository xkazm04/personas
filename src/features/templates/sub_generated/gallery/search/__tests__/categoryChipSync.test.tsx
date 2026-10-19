import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { TemplateSearchBar } from '../TemplateSearchBar';

const noop = () => {};

/** Chip labels painted inside the search input (direct span children). */
function inputChips(): string[] {
  const box = screen.getByTestId('template-search-input').parentElement!;
  return Array.from(box.children).filter((el) => el.tagName === 'SPAN').map((el) => el.textContent ?? '');
}

function Harness({ onCategory }: { onCategory: (c: string[]) => void }) {
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  return (
    <TemplateSearchBar
      search=""
      onSearchChange={noop}
      sortBy="recent"
      onSortByChange={noop}
      sortDir="desc"
      onSortDirChange={noop}
      connectorFilter={[]}
      onConnectorFilterChange={noop}
      categoryFilter={categoryFilter}
      onCategoryFilterChange={(c) => { onCategory(c); setCategoryFilter(c); }}
      availableConnectors={[]}
      availableCategories={[{ name: 'communication', count: 3 }]}
      total={3}
      loadedCount={3}
    />
  );
}

describe('category chip shared by the search input and the filter row', () => {
  it('clearing it from the filter row clears the input chip and the remembered query', () => {
    const onCategory = vi.fn();
    const first = render(<Harness onCategory={onCategory} />);
    const input = screen.getByTestId('template-search-input');
    const inputBox = input.parentElement!;
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('option', { name: 'Communication' }));
    expect(onCategory).toHaveBeenLastCalledWith(['communication']);
    expect(inputChips()).toEqual(['Communication']);

    // The filter row paints the same category as its own chip with an X.
    const rowLabel = screen.getAllByText('Communication').find((el) => !inputBox.contains(el))!;
    fireEvent.click(within(rowLabel.closest('span')!).getByRole('button'));

    expect(onCategory).toHaveBeenLastCalledWith([]);
    expect(inputChips()).toEqual([]);

    // Leaving the gallery and coming back must not resurrect the category.
    first.unmount();
    onCategory.mockClear();
    render(<Harness onCategory={onCategory} />);
    expect(onCategory).not.toHaveBeenCalledWith(['communication']);
    expect(inputChips()).toEqual([]);
  });
});

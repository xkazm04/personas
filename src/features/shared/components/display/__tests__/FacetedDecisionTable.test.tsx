import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FacetedDecisionTable } from '../FacetedDecisionTable';
import type { DataGridColumn } from '../DataGrid';

interface Item { id: string; path: string }

const items: Item[] = [
  { id: '1', path: 'ui/forms' },
  { id: '2', path: 'ui/tables' },
  { id: '3', path: 'api' },
];

const columns: DataGridColumn<Item>[] = [{ key: 'id', label: 'Id', width: '1fr', render: (r) => r.id }];

const labels = {
  allGroups: 'All',
  summary: (_g: string, n: number) => `${n} items`,
  searchPlaceholder: 'Search items',
  expand: 'Expand',
  collapse: 'Collapse',
  emptyTitle: 'Nothing',
  emptyDescription: 'Nothing here',
};

describe('FacetedDecisionTable rail semantics', () => {
  it('labels the search box, marks the selected group and exposes disclosure state', () => {
    render(
      <FacetedDecisionTable<Item>
        items={items}
        getRowKey={(r) => r.id}
        getGroupPath={(r) => r.path}
        columns={columns}
        searchHaystack={(r) => [r.path]}
        labels={labels}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Search items' })).toBeTruthy();

    const all = screen.getByRole('button', { name: /All/ });
    expect(all.getAttribute('aria-current')).toBe('true');

    const toggle = screen.getByRole('button', { name: 'Expand' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Collapse' }).getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /^api/ }));
    expect(screen.getByRole('button', { name: /^api/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: /All/ }).getAttribute('aria-current')).toBeNull();
  });
});

describe('FacetedDecisionTable selection when the data changes', () => {
  it('falls back to the root when the chosen group no longer exists, and restores it when it returns', () => {
    const props = {
      getRowKey: (r: Item) => r.id,
      getGroupPath: (r: Item) => r.path,
      columns,
      labels,
    };
    const { rerender } = render(<FacetedDecisionTable<Item> items={items} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^api/ }));
    expect(screen.getByText('1 items')).toBeTruthy();

    // The only 'api' item is gone after a refetch.
    rerender(<FacetedDecisionTable<Item> items={items.filter((i) => i.path !== 'api')} {...props} />);
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.getByRole('button', { name: /All/ }).getAttribute('aria-current')).toBe('true');

    rerender(<FacetedDecisionTable<Item> items={items} {...props} />);
    expect(screen.getByText('1 items')).toBeTruthy();
  });
});

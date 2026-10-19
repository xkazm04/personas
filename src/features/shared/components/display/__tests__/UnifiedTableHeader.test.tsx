import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnifiedTable, type TableColumn } from '../UnifiedTable';

interface Row { id: string; name: string }

const rows: Row[] = [{ id: 'a', name: 'Alpha' }];

function table(columns: TableColumn<Row>[]) {
  return (
    <UnifiedTable<Row>
      columns={columns}
      data={rows}
      getRowKey={(r) => r.id}
      rowHeight={40}
      defaultSortKey="name"
      defaultSortDir="asc"
    />
  );
}

describe('UnifiedTable header controls are named for assistive tech', () => {
  it('names the sort button with the active sort state, not only the column', () => {
    render(table([{ key: 'name', label: 'Name', width: '1fr', sortable: true, render: (r) => r.name }]));
    const sort = screen.getByRole('button', { name: /Name/ });
    expect(sort.getAttribute('aria-label')).toMatch(/ascending/i);
  });

  it('gives the icon-only clear-search button a name and the filter toggle its expanded state', () => {
    render(table([{
      key: 'name', label: 'Name', width: '1fr', render: (r) => r.name,
      searchable: true, searchValue: 'al', onSearchChange: vi.fn(),
      filterOptions: [{ value: 'x', label: 'X' }], filterValue: '', onFilterChange: vi.fn(),
    }]));
    const filter = screen.getByTitle(/Filter Name/);
    expect(filter.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByTitle(/Search Name/));
    const unnamed = screen.getAllByRole('button').filter(
      (b) => !b.getAttribute('aria-label') && !b.getAttribute('title') && !b.textContent?.trim(),
    );
    expect(unnamed).toHaveLength(0);
  });
});

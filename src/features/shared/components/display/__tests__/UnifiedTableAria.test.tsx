import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { UnifiedTable, type TableColumn } from '../UnifiedTable';

interface Row { id: string; name: string }
const rows: Row[] = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
const columns: TableColumn<Row>[] = [
  { key: 'name', label: 'Name', width: '1fr', sortable: true, render: (r) => r.name },
  { key: 'id', label: 'Id', width: '1fr', render: (r) => r.id },
];

function table(extra: { ariaLabel?: string; rowHeight?: number; tableId?: string } = {}) {
  return (
    <UnifiedTable<Row>
      columns={columns}
      data={rows}
      getRowKey={(r) => r.id}
      defaultSortKey="name"
      defaultSortDir="asc"
      {...extra}
    />
  );
}

describe('UnifiedTable exposes a valid ARIA table when labelled', () => {
  it('gives the labelled table rows, column headers with aria-sort, and cells', () => {
    render(table({ ariaLabel: 'People' }));
    const t = screen.getByRole('table', { name: 'People' });
    expect(within(t).getAllByRole('row')).toHaveLength(3); // header + 2 data
    const heads = within(t).getAllByRole('columnheader');
    expect(heads).toHaveLength(2);
    expect(heads[0]!.getAttribute('aria-sort')).toBe('ascending');
    expect(heads[1]!.getAttribute('aria-sort')).toBeNull();
    expect(within(t).getAllByRole('cell')).toHaveLength(4);
  });

  it('reports aria-rowcount and aria-rowindex when virtualized', () => {
    render(table({ ariaLabel: 'People', rowHeight: 40 }));
    const t = screen.getByRole('table', { name: 'People' });
    expect(t.getAttribute('aria-rowcount')).toBe('3');
    expect(within(t).getAllByRole('row')[0]!.getAttribute('aria-rowindex')).toBe('1');
  });

  it('adds no row/cell roles to an unlabelled table (they would be orphaned)', () => {
    render(table());
    expect(screen.queryByRole('row')).toBeNull();
    expect(screen.queryByRole('cell')).toBeNull();
  });

  it('lets a resize separator take focus and resize with the arrow keys', () => {
    render(table({ ariaLabel: 'People', tableId: "aria-test" }));
    const sep = screen.getAllByRole('separator')[0]!;
    expect(sep.tabIndex).toBe(0);
    fireEvent.focus(sep);
    expect(sep.getAttribute('aria-valuenow')).not.toBeNull();
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(Number(sep.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(64);
  });
});

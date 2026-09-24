import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataGrid, type DataGridColumn } from '../DataGrid';

interface Row { id: string; name: string; age: string }

const rows: Row[] = [
  { id: 'a', name: 'Alpha', age: '8 min' },
  { id: 'b', name: 'Beta', age: '1 hr' },
];

const columns: DataGridColumn<Row>[] = [
  { key: 'name', label: 'Name', width: '1fr', render: (r) => r.name },
  { key: 'age', label: 'Raised', width: '80px', nowrap: true, align: 'right', render: (r) => r.age },
];

const grid = (fit?: 'fill' | 'content') => (
  <DataGrid<Row> columns={columns} data={rows} getRowKey={(r) => r.id} pageSize={25} fit={fit} />
);

describe('DataGrid fit', () => {
  it("fit='content' sizes the body to its rows: no flex-1, shrinkable, scrolls past the cap", () => {
    render(grid('content'));
    const body = screen.getByTestId('data-grid-body');
    expect(body.className).not.toMatch(/\bflex-1\b/);
    expect(body.className).toMatch(/\bmin-h-0\b/);
    expect(body.className).toMatch(/\boverflow-y-auto\b/);
    // The pager is the body's next sibling: it sits right under the last row.
    expect(body.nextElementSibling?.textContent).toContain('2');
    expect(screen.getByText('Alpha')).toBeTruthy();
  });

  it("defaults to 'fill': the body takes the height it is given", () => {
    render(grid());
    expect(screen.getByTestId('data-grid-body').className).toMatch(/\bflex-1\b/);
  });

  it('keeps a nowrap column on one line and headers never wrap', () => {
    render(grid('content'));
    expect(screen.getByText('8 min').closest('div')?.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(screen.getByText('Name').className).toMatch(/\btruncate\b/);
  });
});

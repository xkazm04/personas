import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataGrid, type DataGridColumn } from '../DataGrid';
import { TABLE_HEAD_LABEL } from '../tableTokens';

interface Row { id: string; status: string }

const rows: Row[] = [{ id: 'a', status: 'open' }];

const columns: DataGridColumn<Row>[] = [
  {
    key: 'status',
    label: 'Status',
    width: '1fr',
    filterOptions: [{ value: 'open', label: 'Open' }],
    filterValue: '',
    onFilterChange: vi.fn(),
    render: (r) => r.status,
  },
];

describe('DataGrid header', () => {
  it('gives a filterable header the shared head-label type, not an uninterpolated placeholder', () => {
    const { container } = render(
      <DataGrid<Row> columns={columns} data={rows} getRowKey={(r) => r.id} pageSize={25} />,
    );
    // The class string must be interpolated: a literal "${TABLE_HEAD_LABEL}" is
    // a dead class and leaves the filter header off the one header scale.
    expect(container.querySelector('[class*="${"]')).toBeNull();
    const headLabelClasses = TABLE_HEAD_LABEL.split(' ');
    const select = container.querySelector('[class*="!pl-2"]');
    expect(select).not.toBeNull();
    for (const cls of headLabelClasses) expect(select!.classList.contains(cls)).toBe(true);
  });

  it('makes the select-all header a keyboard-operable checkbox with a name and state', () => {
    const onSelectAll = vi.fn();
    const selectColumns: DataGridColumn<Row>[] = [
      { key: 'select', label: '', width: '40px', render: () => null },
      { key: 'status', label: 'Status', width: '1fr', render: (r) => r.status },
    ];
    render(
      <DataGrid<Row>
        columns={selectColumns}
        data={rows}
        getRowKey={(r) => r.id}
        pageSize={25}
        selectAll={false}
        onSelectAll={onSelectAll}
      />,
    );
    const box = screen.getByRole('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.getAttribute('aria-label')).toBeTruthy();
    expect(box.tabIndex).toBe(0);
    fireEvent.keyDown(box, { key: ' ' });
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });
});

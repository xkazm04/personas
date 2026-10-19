import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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
});

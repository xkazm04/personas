import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnifiedTable } from '../UnifiedTable';

interface Row { id: string; n: number }

describe('UnifiedTable default sort comparator', () => {
  it('orders numeric cells numerically, not as strings', () => {
    const data: Row[] = [{ id: 'a', n: 10 }, { id: 'b', n: 9 }, { id: 'c', n: 100 }];
    render(
      <UnifiedTable<Row>
        columns={[{ key: 'n', label: 'N', width: '1fr', sortable: true, render: (r) => `v${r.n}` }]}
        data={data}
        getRowKey={(r) => r.id}
        rowHeight={40}
        defaultSortKey="n"
        defaultSortDir="asc"
      />,
    );
    const order = screen.getAllByText(/^v\d+$/).map((el) => el.textContent);
    expect(order).toEqual(['v9', 'v10', 'v100']);
  });
});

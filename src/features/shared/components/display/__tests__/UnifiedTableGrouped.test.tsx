import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnifiedTable, type TableColumn } from '../UnifiedTable';

interface Row { id: string; name: string; group: string }

const rows: Row[] = [
  { id: 'a', name: 'Alpha', group: 'today' },
  { id: 'b', name: 'Beta', group: 'today' },
  { id: 'c', name: 'Gamma', group: 'older' },
];

const columns: TableColumn<Row>[] = [
  { key: 'name', label: 'Name', width: '1fr', render: (r) => r.name },
];

// jsdom has no layout: give scroll containers a size so the virtualizer mounts rows.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
});

const groupBy = (r: Row) => ({ key: r.group, label: r.group });

describe('UnifiedTable grouped body honours the row props the flat body honours', () => {
  it('forwards rowAttrs, activeKey and keyboardNav={false} to grouped rows', () => {
    const { container } = render(
      <UnifiedTable<Row>
        columns={columns}
        data={rows}
        getRowKey={(r) => r.id}
        rowHeight={40}
        groupBy={groupBy}
        onRowClick={vi.fn()}
        keyboardNav={false}
        activeKey="b"
        rowAttrs={(r) => ({ id: `row-${r.id}`, testId: `row-${r.id}` })}
      />,
    );
    expect(screen.getByTestId('row-a').id).toBe('row-a');
    // The caller owns the cursor: activeKey draws it, and no second tab stop competes.
    expect(screen.getByTestId('row-b').className).toMatch(/\bring-1\b/);
    expect(screen.getByTestId('row-a').className).not.toMatch(/\bring-1\b/);
    expect(container.querySelector('[tabindex="0"]')).toBeNull();
  });
});

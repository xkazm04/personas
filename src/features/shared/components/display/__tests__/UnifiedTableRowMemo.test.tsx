import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnifiedTable, type TableColumn } from '../UnifiedTable';
import { __resetSurfaceRevealForTests } from '@/hooks/utility/interaction/useProgressiveReveal';

interface Row {
  id: string;
  name: string;
}

/** Cell renders per row id: the observable for "did this row re-render". */
let renders: Record<string, number> = {};

// Module-scope columns: a stable identity, as a memoized caller would pass.
const columns: TableColumn<Row>[] = [
  {
    key: 'name',
    label: 'Name',
    width: '1fr',
    render: (r) => {
      renders[r.id] = (renders[r.id] ?? 0) + 1;
      return r.name;
    },
  },
];

const rowEl = (text: string) => screen.getByText(text).closest('.row-hover-lift') as HTMLElement;

/** Every table here is virtualized, the bounded path callers should take. */
const ROW_H = 44;

describe('UnifiedTable row memoization', () => {
  beforeEach(() => {
    renders = {};
    __resetSurfaceRevealForTests();
  });

  it('re-renders only the changed row when a sibling row changes (poll with fresh objects)', () => {
    const a = { id: 'a', name: 'Alpha' };
    const b = { id: 'b', name: 'Bravo' };
    const c = { id: 'c', name: 'Charlie' };
    const { rerender } = render(
      // An inline handler per render, as most callers write it.
      <UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={[a, b, c]} getRowKey={(r) => r.id} onRowClick={() => {}} />,
    );
    expect(renders).toEqual({ a: 1, b: 1, c: 1 });

    renders = {};
    rerender(
      <UnifiedTable<Row>
        rowHeight={ROW_H}
        columns={columns}
        // a: same object; b: changed; c: a fresh but equal object (a re-fetch).
        data={[a, { id: 'b', name: 'Bravo 2' }, { id: 'c', name: 'Charlie' }]}
        getRowKey={(r) => r.id}
        onRowClick={() => {}}
      />,
    );
    expect(renders).toEqual({ b: 1 });
    expect(screen.getByText('Bravo 2')).toBeTruthy();
  });

  it('a click still reaches the latest handler after the handler changed', () => {
    const rows = [{ id: 'a', name: 'Alpha' }];
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} onRowClick={first} />,
    );
    rerender(<UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} onRowClick={second} />);
    fireEvent.click(rowEl('Alpha'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(rows[0]);
  });

  it('a keyboard focus move re-renders only the row that gained focus', () => {
    const rows = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }];
    render(<UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} onRowClick={() => {}} />);
    renders = {};
    fireEvent.keyDown(rowEl('Alpha').parentElement!, { key: 'ArrowDown' });
    expect(renders).toEqual({ a: 1 });
  });

  it('keeps an index-reading cell correct when a row is inserted above it', () => {
    const indexColumns: TableColumn<Row>[] = [
      { key: 'rank', label: 'Rank', width: '1fr', render: (r, i) => `${r.name}#${i}` },
    ];
    const b = { id: 'b', name: 'Bravo' };
    const { rerender } = render(<UnifiedTable<Row> rowHeight={ROW_H} columns={indexColumns} data={[b]} getRowKey={(r) => r.id} />);
    expect(screen.getByText('Bravo#0')).toBeTruthy();
    rerender(
      <UnifiedTable<Row> rowHeight={ROW_H} columns={indexColumns} data={[{ id: 'a', name: 'Alpha' }, b]} getRowKey={(r) => r.id} />,
    );
    expect(screen.getByText('Bravo#1')).toBeTruthy();
  });
});

describe('UnifiedTable entrance cascade on warm return', () => {
  beforeEach(() => {
    __resetSurfaceRevealForTests();
  });

  const rows = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }];
  const cascading = () => ['Alpha', 'Bravo'].filter((n) => rowEl(n).classList.contains('animate-fade-in')).length;
  // jsdom has no `AnimationEvent`, so react-dom binds `onAnimationEnd` to the
  // vendor-prefixed `webkitAnimationEnd` (fireEvent.animationEnd never reaches it).
  const finishEntrances = () =>
    ['Alpha', 'Bravo'].forEach((n) => fireEvent(rowEl(n), new Event('webkitAnimationEnd', { bubbles: true })));

  it('a second mount of the same surface key plays 0 cascades', () => {
    const first = render(
      <UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} isLoading={false} tableId="wp3-surface" />,
    );
    expect(cascading()).toBe(2);
    finishEntrances();
    first.unmount();

    render(
      <UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} isLoading={false} tableId="wp3-surface" />,
    );
    expect(cascading()).toBe(0);
  });

  it('a genuinely new row on the warm surface still enters alone', () => {
    const first = render(
      <UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} isLoading={false} tableId="wp3-new-row" />,
    );
    finishEntrances();
    first.unmount();

    render(
      <UnifiedTable<Row>
        rowHeight={ROW_H}
        columns={columns}
        data={[...rows, { id: 'c', name: 'Charlie' }]}
        getRowKey={(r) => r.id}
        isLoading={false}
        tableId="wp3-new-row"
      />,
    );
    expect(cascading()).toBe(0);
    expect(rowEl('Charlie').classList.contains('animate-fade-in')).toBe(true);
  });

  it('a table with no surface key keeps the per-mount seen-set (replays on remount)', () => {
    const first = render(<UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} isLoading={false} />);
    finishEntrances();
    first.unmount();
    render(<UnifiedTable<Row> rowHeight={ROW_H} columns={columns} data={rows} getRowKey={(r) => r.id} isLoading={false} />);
    expect(cascading()).toBe(2);
  });
});

/** DataTable: an opted-in column head is a sort button with aria-sort; plain heads stay plain. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable, type TableRow } from '../index';

type K = 'name' | 'n' | 'note';
const rows: Array<TableRow<K>> = [
  { id: 'a', cells: { name: 'alpha', n: '2' }, sort: { name: 'alpha', n: 2 } },
  { id: 'b', cells: { name: 'beta', n: '9' }, sort: { name: 'beta', n: 9 } },
  { id: 'c', cells: { name: 'gamma', n: '-' }, sort: { name: 'gamma', n: null } },
];
const cols = [
  { key: 'name' as const, label: 'Name', sortable: 'asc' as const },
  { key: 'n' as const, label: 'Count', num: true, sortable: 'desc' as const },
  { key: 'note' as const, label: 'Note' },
];
const order = () => screen.getAllByRole('row').slice(1).map((tr) => tr.getAttribute('data-id'));

describe('DataTable sorting', () => {
  it('uncontrolled: opens on defaultSort, a press flips, another column opens its own direction', () => {
    render(<DataTable<K> label="t" cols={cols} rows={rows} empty={{ title: 'none' }} defaultSort={{ key: 'n', dir: 'desc' }} />);
    expect(order()).toEqual(['b', 'a', 'c']);
    const count = screen.getByRole('columnheader', { name: /Count/ });
    expect(count.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(count.querySelector('button')!);
    expect(order()).toEqual(['a', 'b', 'c']); // absent stays last ascending too
    expect(count.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(screen.getByRole('columnheader', { name: /Name/ }).querySelector('button')!);
    expect(order()).toEqual(['a', 'b', 'c']);
    expect(count.getAttribute('aria-sort')).toBe('none');
  });

  it('controlled: reports the next sort and renders only what it is given', () => {
    const onSortChange = vi.fn();
    render(<DataTable<K> label="t" cols={cols} rows={rows} empty={{ title: 'none' }} sort={{ key: 'name', dir: 'desc' }} onSortChange={onSortChange} />);
    expect(order()).toEqual(['c', 'b', 'a']);
    fireEvent.click(screen.getByRole('columnheader', { name: /Name/ }).querySelector('button')!);
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', dir: 'asc' });
    expect(order()).toEqual(['c', 'b', 'a']);
  });

  it('a table with no sortable column keeps the given order and plain heads', () => {
    render(<DataTable<K> label="t" cols={cols.map(({ key, label }) => ({ key, label }))} rows={[rows[2]!, rows[0]!]} empty={{ title: 'none' }} />);
    expect(order()).toEqual(['c', 'a']);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('columnheader', { name: 'Name' }).hasAttribute('aria-sort')).toBe(false);
  });
});

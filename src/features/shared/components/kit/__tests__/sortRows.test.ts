import { describe, expect, it } from 'vitest';
import { nextSort, sortRows } from '../sortRows';

type K = 'n' | 's';
const r = (id: string, n: number | null | undefined, s?: string | null) => ({ id, sort: { n, s } as Partial<Record<K, number | string | null | undefined>> });
const ids = (rows: Array<{ id: string }>) => rows.map((x) => x.id);

describe('sortRows', () => {
  const rows = [r('c', 2), r('a', 2), r('d', null), r('b', 10), r('e', undefined), r('f', Number.NaN), r('g', 1)];

  it('orders numbers numerically, ascending, ties by id, absent last', () => {
    expect(ids(sortRows(rows, { key: 'n', dir: 'asc' }))).toEqual(['g', 'a', 'c', 'b', 'd', 'e', 'f']);
  });
  it('keeps absent values last and the tie order by id when descending', () => {
    expect(ids(sortRows(rows, { key: 'n', dir: 'desc' }))).toEqual(['b', 'a', 'c', 'g', 'd', 'e', 'f']);
  });
  it('is deterministic whatever order the rows arrive in', () => {
    const shuffled = [rows[4]!, rows[1]!, rows[6]!, rows[0]!, rows[3]!, rows[5]!, rows[2]!];
    expect(ids(sortRows(shuffled, { key: 'n', dir: 'asc' }))).toEqual(ids(sortRows(rows, { key: 'n', dir: 'asc' })));
  });
  it('collates text case-insensitively with numeric runs as numbers', () => {
    const t = [r('1', 0, 'item10'), r('2', 0, 'Item2'), r('3', 0, 'item1'), r('4', 0, null)];
    expect(ids(sortRows(t, { key: 's', dir: 'asc' }, 'en'))).toEqual(['3', '2', '1', '4']);
  });
  it('returns the rows as given when there is no sort, and never mutates the input', () => {
    const copy = [...rows];
    expect(ids(sortRows(rows, null))).toEqual(ids(rows));
    sortRows(rows, { key: 'n', dir: 'asc' });
    expect(rows).toEqual(copy);
  });
});

describe('nextSort', () => {
  it('opens a new column in its own direction and flips the active one', () => {
    expect(nextSort(null, 'n', 'desc')).toEqual({ key: 'n', dir: 'desc' });
    expect(nextSort({ key: 'n', dir: 'desc' }, 'n', 'desc')).toEqual({ key: 'n', dir: 'asc' });
    expect(nextSort({ key: 'n', dir: 'asc' }, 's', 'asc')).toEqual({ key: 's', dir: 'asc' });
  });
});

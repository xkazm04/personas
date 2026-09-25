/**
 * DataTable's order contract (registry: table / sorting): given the same rows and the same sort,
 * the same sequence every time. Numbers compare as numbers, text by the reader's collation
 * (case-insensitive, numeric runs as numbers), an absent value (null, undefined, NaN) sorts
 * last in either direction, and the row id breaks every tie so equal keys never shuffle.
 */
export type SortDir = 'asc' | 'desc';

/** The one sort a table holds: a column key and a direction. */
export interface TableSort<K extends string> {
  key: K;
  dir: SortDir;
}

export type SortValue = string | number | null | undefined;

const absent = (v: SortValue): v is null | undefined => v == null || (typeof v === 'number' && Number.isNaN(v));

/**
 * @catalog sortRows - the kit's stable table order: typed compare, absent values last, row id breaks ties. Kit.
 */
export function sortRows<K extends string, R extends { id: string; sort?: Partial<Record<K, SortValue>> }>(
  rows: readonly R[],
  sort: TableSort<K> | null | undefined,
  locale?: string,
): R[] {
  if (!sort) return [...rows];
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a.sort?.[sort.key];
    const vb = b.sort?.[sort.key];
    const na = absent(va);
    const nb = absent(vb);
    if (na !== nb) return na ? 1 : -1; // absent last, whatever the direction
    if (!na && !nb) {
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
      if (c !== 0) return sign * c;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // identity tiebreaker, direction-independent
  });
}

/** The next sort after a press on `key`: the same column flips, a new one opens in its own direction. */
export function nextSort<K extends string>(cur: TableSort<K> | null | undefined, key: K, opening: SortDir): TableSort<K> {
  if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: opening };
}

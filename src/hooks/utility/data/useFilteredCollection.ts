import { useMemo } from 'react';

/**
 * Declarative filter matchers for useFilteredCollection.
 *
 * - `exact`: skip when value is null/undefined/empty string; otherwise match field === value.
 *            Use `fallback` when the field may be null/undefined and should default (e.g. source ?? 'local').
 * - `custom`: arbitrary predicate; pass null to skip.
 */
export interface FilterSpec<T> {
  exact?: Array<{ field: keyof T; value: string | null | undefined; fallback?: string }>;
  custom?: Array<((item: T) => boolean) | null>;
}

export interface FilteredResult<T> {
  filtered: T[];
  total: number;
  isEmpty: boolean;
}

/**
 * Generic memoized collection filter.
 * Replaces duplicated persona/status/date useMemo chains across list views.
 */
export function useFilteredCollection<T>(
  items: T[],
  spec: FilterSpec<T>,
): FilteredResult<T> {
  return useMemo(() => {
    let result = items;

    if (spec.exact) {
      for (const matcher of spec.exact) {
        const v = matcher.value;
        if (v == null || v === '') continue;
        const fallback = matcher.fallback;
        result = result.filter((item) => {
          const fieldVal = item[matcher.field];
          const resolved = (fieldVal == null && fallback != null) ? fallback : fieldVal;
          return resolved === v;
        });
      }
    }

    if (spec.custom) {
      for (const predicate of spec.custom) {
        if (!predicate) continue;
        result = result.filter(predicate);
      }
    }

    return {
      filtered: result,
      total: items.length,
      isEmpty: result.length === 0,
    };
  }, [items, spec]);
}

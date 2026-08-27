import { useMemo, useRef } from 'react';

type ExactMatchers<T> = NonNullable<FilterSpec<T>['exact']>;
type CustomMatchers<T> = NonNullable<FilterSpec<T>['custom']>;

const EMPTY_EXACT: ExactMatchers<never> = [];
const EMPTY_CUSTOM: CustomMatchers<never> = [];

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
 *
 * `spec` is an object literal at every call site, so depending on its identity
 * re-ran the filter on every render — the memo never hit, and `filtered` came
 * back as a brand-new array each time, which is the head of the identity chain
 * that defeats every downstream `useMemo`/`memo` (see the note at
 * `features/fleet/monitor/useMonitorData.ts:93`). The dependency is therefore
 * the spec's *contents*: the `exact` matchers are plain data and are compared
 * by value; the `custom` predicates are already `useCallback`-stable at the
 * call sites, so their identities are the honest dependency and are compared
 * element-wise.
 */
export function useFilteredCollection<T>(
  items: T[],
  spec: FilterSpec<T>,
): FilteredResult<T> {
  const exact = spec.exact ?? (EMPTY_EXACT as ExactMatchers<T>);
  const custom = spec.custom ?? (EMPTY_CUSTOM as CustomMatchers<T>);

  const exactSignature = JSON.stringify(
    exact.map((m) => [String(m.field), m.value ?? null, m.fallback ?? null]),
  );
  const exactRef = useRef(exact);
  const exactSignatureRef = useRef(exactSignature);
  if (exactSignatureRef.current !== exactSignature) {
    exactSignatureRef.current = exactSignature;
    exactRef.current = exact;
  }

  const customRef = useRef(custom);
  const prevCustom = customRef.current;
  if (
    prevCustom.length !== custom.length ||
    custom.some((fn, i) => fn !== prevCustom[i])
  ) {
    customRef.current = custom;
  }

  const stableExact = exactRef.current;
  const stableCustom = customRef.current;

  return useMemo(() => {
    let result = items;

    for (const matcher of stableExact) {
      const v = matcher.value;
      if (v == null || v === '') continue;
      const fallback = matcher.fallback;
      result = result.filter((item) => {
        const fieldVal = item[matcher.field];
        const resolved = (fieldVal == null && fallback != null) ? fallback : fieldVal;
        return resolved === v;
      });
    }

    for (const predicate of stableCustom) {
      if (!predicate) continue;
      result = result.filter(predicate);
    }

    return {
      filtered: result,
      total: items.length,
      isEmpty: result.length === 0,
    };
  }, [items, stableExact, stableCustom]);
}

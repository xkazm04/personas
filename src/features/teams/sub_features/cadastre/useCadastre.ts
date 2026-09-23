// The Cadastre's state: what the register shows, which deed is focused, which
// one is open as a layer, which filter and which lens are on. One hook, so the
// keyboard, the register, the map and the layer read and write the same thing.
//
// The derived views (the ranked register, the claims per parcel, the tones)
// are built from the page's one model and never re-derive a rule it owns.
import { useCallback, useMemo, useState } from 'react';

import { matchesQuery } from '@/lib/text/search';

import type { FeatureSort } from '../featureRules';
import type { FeaturesModel } from '../featuresModel';
import {
  catsOf,
  claimsOf,
  matchesFilter,
  matchesRow,
  rankRoster,
  rehearse,
  type CadFilter,
  type CadRow,
  type ParcelCat,
} from './cadastreModel';

const SORT_CYCLE: readonly FeatureSort[] = ['move', 'name', 'score', 'span'];

export function useCadastre(model: FeaturesModel, language: string) {
  const [sort, setSort] = useState<FeatureSort>('move');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CadFilter | null>(null);
  const [big, setBig] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [lens, setLens] = useState(false);
  const [hlCat, setHlCat] = useState<ParcelCat | null>(null);
  const [hotCtx, setHotCtx] = useState<string | null>(null);
  const [ogFocus, setOgFocus] = useState<string | null>(null);

  const contextName = useCallback((id: string) => model.cellById.get(id)?.context.name ?? id, [model]);
  const ranked = useMemo(
    () => rankRoster(big ? rehearse(model.rows) : model.rows.map((row) => ({ row, key: row.feature.id, dup: null })), sort),
    [model, big, sort],
  );
  const visible = useMemo(
    () => ranked.filter((r) => matchesFilter(r, filter) && matchesRow(r, query, contextName, language)),
    [ranked, filter, query, contextName, language],
  );
  const byKey = useMemo(() => new Map(ranked.map((r) => [r.key, r])), [ranked]);
  const claims = useMemo(() => claimsOf(ranked), [ranked]);
  const cats = useMemo(() => catsOf(model), [model]);

  /** The unclaimed ground, filtered by context or district name. */
  const unclaimed = useMemo(() => {
    const groupName = new Map(model.plots.map((p) => [p.group.id, p.group.name]));
    return model.unclaimed.filter((cell) => {
      if (!query) return true;
      const g = groupName.get(cell.context.groupId ?? '') ?? '';
      return matchesQuery(cell.context.name, query, language) || matchesQuery(g, query, language);
    });
  }, [model, query, language]);

  const open = sel != null && byKey.has(sel);
  const selected: CadRow | null = open ? byKey.get(sel) ?? null : null;
  /** The deed the map surveys: the open one, else the previewed row. */
  const active: CadRow | null = filter === 'unclaimed' ? null : selected ?? (preview ? byKey.get(preview) ?? null : null);

  const focusRow = useCallback((key: string | null) => {
    setFocus(key);
    setPreview(key);
  }, []);

  const moveFocus = useCallback((d: number) => {
    if (visible.length === 0) return;
    const i = visible.findIndex((r) => r.key === focus);
    const j = i < 0 ? (d > 0 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, i + d));
    focusRow(visible[j]!.key);
  }, [visible, focus, focusRow]);

  const moveUnclaimed = useCallback((d: number) => {
    if (unclaimed.length === 0) return;
    const i = unclaimed.findIndex((c) => c.context.id === ogFocus);
    const j = i < 0 ? (d > 0 ? 0 : unclaimed.length - 1) : Math.max(0, Math.min(unclaimed.length - 1, i + d));
    const id = unclaimed[j]!.context.id;
    setOgFocus(id);
    setHotCtx(id);
  }, [unclaimed, ogFocus]);

  const stepDeed = useCallback((d: number) => {
    if (visible.length === 0) return;
    const i = visible.findIndex((r) => r.key === sel);
    const j = Math.max(0, Math.min(visible.length - 1, (i < 0 ? 0 : i) + d));
    if (j === i) return;
    const key = visible[j]!.key;
    setSel(key);
    focusRow(key);
  }, [visible, sel, focusRow]);

  const toggleFilter = useCallback((next: CadFilter) => {
    const on = filter === next ? null : next;
    if (filter === 'unclaimed' || on === 'unclaimed') setQuery('');
    setSel(null);
    setFilter(on);
    setOgFocus(null);
    setHotCtx(null);
    if (on === 'unclaimed') setPreview(null);
    else if (on) {
      const first = ranked.find((r) => matchesFilter(r, on));
      if (first && !matchesFilter(byKey.get(focus ?? '') ?? first, on)) focusRow(first.key);
      else if (first && focus == null) focusRow(first.key);
    }
  }, [filter, ranked, byKey, focus, focusRow]);

  const cycleSort = useCallback(() => {
    setSort((s) => SORT_CYCLE[(SORT_CYCLE.indexOf(s) + 1) % SORT_CYCLE.length]!);
  }, []);

  const toggleBig = useCallback(() => {
    setBig((b) => !b);
    setSel(null);
  }, []);

  return {
    sort, setSort, cycleSort, query, setQuery, filter, toggleFilter, big, toggleBig,
    focus, focusRow, moveFocus, preview, setPreview, sel, setSel, open, selected, active, stepDeed,
    lens, setLens, hlCat, setHlCat, hotCtx, setHotCtx, ogFocus, setOgFocus, moveUnclaimed,
    ranked, visible, byKey, claims, cats, unclaimed, contextName,
  };
}

export type Cadastre = ReturnType<typeof useCadastre>;

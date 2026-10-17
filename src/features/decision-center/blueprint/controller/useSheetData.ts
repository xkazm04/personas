// The sheet's read side: the product as the source gave it, the plan (structural; computed once per map), and the
// work (the store's rows read against the plan; recomputed whenever the rows change). `reload` re-reads the source
// after a write or an outside change (the live refresh) and keeps every part of the data that did not change, so a
// read that found nothing new changes no state at all. `initial` is read once: mount the sheet with a new `key` to
// open another product.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { BlueprintActions, BlueprintData } from '../source';
import { buildPlan, type Plan } from '../model/plan';
import { sameJson } from '../model/same';
import { buildWork, type Work } from '../model/work';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';

export interface SheetData {
  data: BlueprintData;
  plan: Plan;
  work: Work;
  /** Re-read the source. Resolves true when it answered (a completion a newer read superseded counts as answered). */
  reload(): Promise<boolean>;
  /** When the last read finished (ms), whoever asked for it; the live refresh throttles on it. */
  readAt: MutableRefObject<number>;
}

const sameMap = (a: BlueprintData, b: BlueprintData): boolean => a.events === b.events && sameJson(a.structure, b.structure);

/**
 * The previous data when `next` says nothing new, else `next` with every unchanged part kept by identity: the map (so
 * the plan and the camera fitted to it are not rebuilt for a status flip), the scan (so the work, and the canvas
 * raster behind it, is not recomputed when only the products list moved) and the products.
 */
export function mergeRead(prev: BlueprintData, next: BlueprintData): BlueprintData {
  const structure = prev.structure === next.structure || sameMap(prev, next) ? prev.structure : next.structure;
  const events = structure === prev.structure ? prev.events : next.events;
  const scan = sameJson(prev.scan, next.scan) ? prev.scan : next.scan;
  const products = sameJson(prev.products, next.products) ? prev.products : next.products;
  const merged: BlueprintData = { ...next, structure, events, scan, products };
  if (products === undefined) delete merged.products;
  const unchanged = structure === prev.structure && events === prev.events && scan === prev.scan && products === prev.products
    && prev.lastRunAt === next.lastRunAt && prev.storeVersion === next.storeVersion && sameJson(prev.product, next.product);
  return unchanged ? prev : merged;
}

export function useSheetData(initial: BlueprintData, actions: BlueprintActions): SheetData {
  const [data, setData] = useState(initial);
  const alive = useRef(true);
  // the newest read started: a completion that is not it is older than something already in flight, and is dropped
  const latest = useRef(createLatestWins()).current;
  const readAt = useRef(Date.now());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const plan = useMemo(() => buildPlan(data.structure, data.events), [data.structure, data.events]);
  const work = useMemo(() => buildWork(plan.L, data.scan), [plan, data.scan]);
  const reload = useCallback(async () => {
    const mine = latest.next();
    try {
      const next = await actions.refresh();
      readAt.current = Date.now();
      if (alive.current && latest.isCurrent(mine)) setData((prev) => mergeRead(prev, next));
      return true;
    } catch (err) {
      silentCatch('blueprint:refresh')(err);
      return false;
    }
  }, [actions, latest]);
  return { data, plan, work, reload, readAt };
}

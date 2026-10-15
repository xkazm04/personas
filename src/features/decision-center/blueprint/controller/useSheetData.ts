// The sheet's read side: the product as the source gave it, the plan (structural; computed once per map), and the
// work (the store's rows read against the plan; recomputed whenever the rows change). `reload` re-reads the source
// after a write or an outside change and keeps the plan when only the rows moved. `initial` is read once: mount the
// sheet with a new `key` to open another product.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlueprintActions, BlueprintData } from '../source';
import { buildPlan, type Plan } from '../model/plan';
import { sameJson } from '../model/same';
import { buildWork, type Work } from '../model/work';
import { silentCatch } from '@/lib/silentCatch';

export interface SheetData {
  data: BlueprintData;
  plan: Plan;
  work: Work;
  /** Re-read the source. Resolves true when it answered. */
  reload(): Promise<boolean>;
}

const sameMap = (a: BlueprintData, b: BlueprintData): boolean => a.events === b.events && sameJson(a.structure, b.structure);

export function useSheetData(initial: BlueprintData, actions: BlueprintActions): SheetData {
  const [data, setData] = useState(initial);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const plan = useMemo(() => buildPlan(data.structure, data.events), [data.structure, data.events]);
  const work = useMemo(() => buildWork(plan.L, data.scan), [plan, data.scan]);
  const reload = useCallback(async () => {
    try {
      const next = await actions.refresh();
      // a re-read parses the map again: keep the OLD map object when nothing in it changed, so the plan (and the
      // camera that was fitted to it) is not rebuilt for a status flip
      if (alive.current) setData((prev) => (prev.structure === next.structure || sameMap(prev, next) ? { ...next, structure: prev.structure, events: prev.events } : next));
      return true;
    } catch (err) {
      silentCatch('blueprint:refresh')(err);
      return false;
    }
  }, [actions]);
  return { data, plan, work, reload };
}

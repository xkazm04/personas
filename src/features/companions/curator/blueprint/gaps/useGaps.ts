/**
 * The three reads behind the Gaps drawer, taken once when it opens.
 *
 * ON OPEN, NOT ON MOUNT. All three are cheap - two are pure database reads and
 * the third walks the registry's two skill lanes on disk - but none of them is
 * free, and the drawer is shut most of the time. A page that paid for them at
 * mount would pay on every navigation to the Blueprint for a surface nobody
 * asked for.
 *
 * NO POLLING, which is the page's own standing rule. Her pulse already fires
 * whenever her loop's observable state moves, and the caller re-reads on it; a
 * drawer that polled would be the second clock on a page built to have none.
 *
 * **A door that did not answer is `null`, never an empty reading.** All three
 * absences are different facts from their empty values: no impediments means her
 * plan is fully dispatchable, no growth samples means nobody has projected yet,
 * no quiet runs means nothing is in limbo - and each of those is a thing worth
 * saying, so none of them may be spelled the same way as "the read failed".
 */
import { useCallback, useEffect, useState } from 'react';

import { curatorAttritionGet, curatorGrowthGet, curatorImpedimentsGet } from '@/api/curator';
import type { CuratorAttrition } from '@/lib/bindings/CuratorAttrition';
import type { CuratorGrowthReading } from '@/lib/bindings/CuratorGrowthReading';
import type { CuratorImpediment } from '@/lib/bindings/CuratorImpediment';
import { silentCatch } from '@/lib/silentCatch';

export interface GapsReading {
  /** `null` = the door did not answer. `[]` = nothing blocks her. */
  impediments: CuratorImpediment[] | null;
  growth: CuratorGrowthReading | null;
  attrition: CuratorAttrition | null;
  loading: boolean;
  reload: () => void;
}

export function useGaps(open: boolean, pulse: number): GapsReading {
  const [impediments, setImpediments] = useState<CuratorImpediment[] | null>(null);
  const [growth, setGrowth] = useState<CuratorGrowthReading | null>(null);
  const [attrition, setAttrition] = useState<CuratorAttrition | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    // Settled, not all: one door failing must not blank the other two. Each
    // result is applied on its own and a rejection leaves that one `null`,
    // which is what the surface draws as unread.
    void Promise.allSettled([curatorImpedimentsGet(), curatorGrowthGet(), curatorAttritionGet()])
      .then(([i, g, a]) => {
        if (!live) return;
        if (i.status === 'fulfilled') setImpediments(i.value);
        else silentCatch('curator.gaps.impediments')(i.reason);
        if (g.status === 'fulfilled') setGrowth(g.value);
        else silentCatch('curator.gaps.growth')(g.reason);
        if (a.status === 'fulfilled') setAttrition(a.value);
        else silentCatch('curator.gaps.attrition')(a.reason);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, pulse, nonce]);

  return { impediments, growth, attrition, loading, reload };
}

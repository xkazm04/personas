/**
 * THE FILING BENCH - Blueprint v2, variant C.
 *
 * The inversion: the operator's queue is the SUBJECT of this page and her plan
 * is the reference he consults while filing. Both columns are half width; what
 * changed is which one was designed first and which one serves the other.
 *
 * The one idea: **the bundle is the join**. The cheap pre-read pass returns a
 * topic and a high-level domain for each raw link, and that domain is the same
 * vocabulary her plan is indexed by. So her rows can tell him how many of his
 * intakes already point at each bundle, pressing that number filters his queue
 * to them, and - the part that earns the page's law - that count is UNKNOWN
 * while any intake is still unread, because any of them could still land there.
 * A zero in that cell would be the page telling its own central lie in the one
 * cell the redesign invented.
 *
 * Both columns therefore draw through `Ink.tsx`: a count, a measured zero, an
 * unknown and an unmeasurable, four Tone x Glyph pairs and four different words.
 *
 * Material: `curator_request` and `curator_plan_item` are both empty today, so
 * the bench carries `fixture.ts` - forty links and what the pass returns for
 * each. State arrives through `useBench`, which is written as a reducer over a
 * pushed stream; the day `COMPANIONS_STATUS_CHANGED` carries a request, that
 * one file subscribes instead of scheduling and nothing else moves.
 */
import { useMemo, useState } from 'react';

import { KitHost, Surface } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { BlueprintWordsProvider, type BlueprintWords } from '../../../words';
import { LaneColumn } from './LaneColumn';
import { PlanColumn } from './PlanColumn';
import { useBench } from './useBench';

import './bench.css';

export default function BlueprintV2VariantC() {
  const { t, tx } = useTranslation();
  const bench = useBench();
  const [bundle, setBundle] = useState<string | null>(null);

  // The shipped page's own words contract, reused rather than re-invented: one
  // resolved leaf handed down a context, so a forty-row list mounts without a
  // store subscription per glyph.
  const words: BlueprintWords = useMemo(
    () => ({ w: t.companions.blueprint, tx }),
    [t.companions.blueprint, tx],
  );

  /** The three numbers the join sentence needs, and it never sums them. */
  const filed = useMemo(() => {
    const live = bench.intakes.filter((i) => i.state !== 'cancelled');
    return {
      total: live.length,
      read: live.filter((i) => i.read.kind === 'read').length,
      pending: live.filter((i) => i.read.kind === 'unread').length,
      unreadable: live.filter((i) => i.read.kind === 'unreadable').length,
    };
  }, [bench.intakes]);

  return (
    <BlueprintWordsProvider value={words}>
      <div className="cb-root">
        <KitHost compact testId="curator-bench">
          <div className="cb-bench">
            <div className="cb-col">
              <Surface dense>
                <LaneColumn bench={bench} bundle={bundle} onBundle={setBundle} />
              </Surface>
            </div>
            <div className="cb-col">
              <Surface dense>
                <PlanColumn joinFor={bench.joinFor} bundle={bundle} onBundle={setBundle} filed={filed} />
              </Surface>
            </div>
          </div>
        </KitHost>
      </div>
    </BlueprintWordsProvider>
  );
}

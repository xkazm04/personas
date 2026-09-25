/**
 * BLUEPRINT v2, variant B - "The Loudest Reason".
 *
 * The bet: nine columns score a subject, but a person deciding what to run
 * tonight needs ONE number and ONE sentence per subject - the reason that
 * dominates, in the registry's own words, and the weight it carries. The other
 * eight are not deleted and not summarised; they are one press away, and the
 * strip on the row is drawn so that you can SEE how much of the story the one
 * sentence is telling. A row whose dominant reason carries all of its points
 * and a row whose dominant reason carries a third of them look different at
 * rest, which is what makes leaving eight out honest rather than lossy.
 *
 * The right half is the operator's lane, and it is sized for how he actually
 * works: forty URLs at a sitting. It is designed for the state those forty
 * spend most of their life in - raw, unread, with no topic and no domain yet -
 * and that state is drawn, not shimmered.
 *
 * One vocabulary spans both halves: a count, a measured zero, an unknown and
 * an unmeasurable are four inks, told apart by shape before colour (`facts.tsx`).
 * The plan is built by the app's own `buildModel`, so those four are decided
 * where the app decides them and this variant cannot invent a kinder truth.
 *
 * Reached at `?v2=b`. Prototype: the data source switch in the header exists so
 * the three real states - measured, nothing measured yet, doors refused - can
 * be judged side by side; it goes when a variant is fused.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { KitHost, Segmented, Surface, type SegmentOption } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { buildModel } from '../../../model/buildModel';
import { unmeasuredModel } from '../../../model/unmeasured';
import { BlueprintWordsProvider, type BlueprintWords } from '../../../words';
import { FIXTURE_INTAKES, FIXTURE_PLAN, FIXTURE_POLICY, type Intake } from './fixture';
import { EN } from './strings';
import { PlanColumn } from './PlanColumn';
import { QueueColumn, type LaneFilter } from './QueueColumn';
import { useLane } from './useLane';

import './v2b.css';

/** Which of the three real states the prototype is showing. */
type Source = 'loaded' | 'now' | 'unread';

export default function BlueprintV2VariantB() {
  const { t, tx } = useTranslation();
  const words: BlueprintWords = useMemo(() => ({ w: t.companions.blueprint, tx }), [t.companions.blueprint, tx]);
  const w = words.w;

  const [source, setSource] = useState<Source>('loaded');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LaneFilter>('all');
  const [query, setQuery] = useState('');
  const [rawOnly, setRawOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // The key map is bound on the surface, not on `window`, so it never eats a
  // key while the operator is elsewhere - which needs focus to start inside it.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const model = useMemo(
    () =>
      source === 'loaded'
        ? buildModel(FIXTURE_PLAN, { policy: FIXTURE_POLICY })
        : unmeasuredModel(source === 'now' ? { policy: FIXTURE_POLICY } : {}),
    [source],
  );

  // The lane's one read. `null` is a door that did not answer and is carried
  // through untouched; `[]` is a lane with nothing in it. Two facts, two values.
  const read = useCallback(
    (): Promise<Intake[] | null> =>
      Promise.resolve(source === 'loaded' ? FIXTURE_INTAKES : source === 'now' ? [] : null),
    [source],
  );
  const lane = useLane(read);

  const view = useMemo(
    () => ({
      filter,
      setFilter,
      query,
      setQuery,
      rawOnly,
      toggleRaw: () => {
        setRawOnly((v) => !v);
      },
      searchRef,
    }),
    [filter, query, rawOnly],
  );

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setOpenId(null);
      return;
    }
    if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      searchRef.current?.focus();
    }
  }, []);

  const sources: SegmentOption<Source>[] = [
    { v: 'loaded', label: EN.sourceLoaded },
    { v: 'now', label: EN.sourceNow },
    { v: 'unread', label: EN.sourceRefused },
  ];

  return (
    <BlueprintWordsProvider value={words}>
      {/* The kit's host carries no height of its own; this wrapper is what
          binds the surface to the route's box so the two columns can scroll
          independently instead of growing the page. */}
      <div className="v2b-root">
        <KitHost compact testId="blueprint-v2-b">
          <div
            className="v2b"
            ref={rootRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            role="application"
            aria-label={w.title}
          >
            <header className="v2b__head">
              <h1 className="typo-section-title v2b__title">{w.title}</h1>
              <span className="typo-caption k-quiet k-ellipsis">
                {model.registryHeadSha ? tx(w.head_projection, { sha: model.registryHeadSha }) : w.meta_unrun}
              </span>
              <Segmented label={w.subtitle} options={sources} value={source} onChange={setSource} />
            </header>
            <div className="v2b__cols">
              <section className="v2b__col" aria-label={w.ledger_region}>
                <Surface dense>
                  <PlanColumn model={model} openId={openId} onOpen={setOpenId} />
                </Surface>
              </section>
              <section className="v2b__col" aria-label={w.console.lane_title}>
                <Surface dense>
                  <QueueColumn intakes={lane.intakes} loading={lane.loading} view={view} />
                </Surface>
              </section>
            </div>
          </div>
        </KitHost>
      </div>
    </BlueprintWordsProvider>
  );
}

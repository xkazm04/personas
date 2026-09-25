/**
 * The thin container: read the plan, build the model, hand it to the
 * primitive. Everything visual lives in `<Blueprint>`, which knows nothing
 * about IPC - that is what lets the whole page be measured in a harness.
 *
 * ## Running the instrument
 *
 * `curator_plan_refresh` had no caller anywhere in `src/`, which is the whole
 * reason `curator_plan_current` returned null and this page read "No
 * projection yet": nothing had ever asked her to look. The console owns that
 * act, and it owns it in EVERY phase - one run control on the page, always in
 * the same place.
 *
 * The refresh costs about eleven seconds cold (it spawns up to four node
 * processes, cached five minutes on the registry's HEAD), so it is drawn as an
 * ACTION - a real spinner on the control the operator pressed - and never as a
 * surface ghost. See `console/CuratorConsole.tsx`.
 *
 * ## The page also LISTENS
 *
 * `curator_plan_refresh` is the operator's own act and answers him directly.
 * Her loop's work is not: a reconcile pass supersedes the standing run while
 * nobody is pressing anything, and a worker that ends without landing writes
 * its plan item to `blocked`. Both change a row this page is drawing, so the
 * page re-reads on her pulse (`console/curatorPulse.ts`) - subscribed on mount,
 * dropped on unmount, and on no clock whatsoever.
 *
 * ## Why there is no empty state here
 *
 * There used to be: with no plan the page rendered a console over one
 * whole-page `<EmptyState>` and nothing else - no verdict, no channel heads,
 * no bands, no foot. The operator asked for the opposite, and he is right: the
 * first pass should be started from a page that already looks like itself.
 *
 * So the model is always built. `unmeasuredModel()` is the same shape with
 * every quantity ABSENT rather than zero, and each surface draws its
 * unpopulated form with the ledger's own unknown ink. A skeleton of zeros on a
 * page whose entire argument is that an unknown is not a zero would be the
 * worst possible first contact with it.
 *
 * Three phases stay distinct, and the ledger body says which one it is in: a
 * first read in flight, an instrument running now, and a read that came back
 * with no projection. Only the last one is an offer.
 *
 * The docket ships EMPTY on purpose. There is no `curator_decisions_list` and
 * nothing writes a decision yet, so there is nothing to read; the drawer says
 * so rather than drawing a zero it did not measure.
 *
 * ## No tab strip
 *
 * A prototype round put three variants behind a switcher here. The operator
 * judged none of them an improvement, so this file is the page again: ONE
 * component, whose first statement is `useTranslation()`. The scaffold before
 * the switcher returned a variant BEFORE that call ran - a rules-of-hooks
 * violation that only ever worked because the choice could not change while
 * mounted - and the shape below cannot reintroduce it, because there is no
 * branch above the hooks to reintroduce it from.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { curatorPlanCurrent, curatorPlanRefresh, curatorPolicyGet, curatorProjectsList } from '@/api/curator';
import { useTranslation } from '@/i18n/useTranslation';
import type { CuratorPlan } from '@/lib/bindings/CuratorPlan';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import { Blueprint } from './Blueprint';
import { CuratorConsole, type RefreshOutcome } from './console/CuratorConsole';
import { PLAN_MOVED, useCuratorPulse } from './console/curatorPulse';
import { RequestLane } from './console/RequestLane';
import { useCuratorLoop } from './console/useCuratorLoop';
import type { BlueprintPhase } from './ledger/LedgerEmpty';
import { buildModel, type BlueprintSources } from './model/buildModel';
import { EMPTY_DOCKET } from './model/docket';
import { unmeasuredModel } from './model/unmeasured';
import type { BlueprintWords } from './words';

import './blueprint.css';

/**
 * The last read of this session, so a remount paints warm, not a re-ghost.
 * One slot, not a keyed cache: there is exactly one registry.
 */
let warm: { plan: CuratorPlan | null; sources: BlueprintSources } | null = null;

export default function BlueprintPage() {
  const { t, tx } = useTranslation();
  const [plan, setPlan] = useState<CuratorPlan | null>(warm?.plan ?? null);
  const [sources, setSources] = useState<BlueprintSources>(warm?.sources ?? {});
  const [loading, setLoading] = useState(!warm);
  const [refreshing, setRefreshing] = useState(false);
  // What the LAST run of the instrument did. Null before he has run one - which
  // is not "nothing changed", and the live region stays silent for it.
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null);
  const loop = useCuratorLoop();
  const { reload } = loop;

  const load = useCallback(async () => {
    // Three doors, settled independently. The policy and the consent list are
    // beside the plan, not under it: a page that refused to draw the ledger
    // because a settings read failed would be hostage to the smaller answer.
    const [planRes, policyRes, projectsRes] = await Promise.allSettled([
      curatorPlanCurrent(),
      curatorPolicyGet(),
      curatorProjectsList(),
    ]);
    if (planRes.status === 'rejected') {
      toastCatch('curator:blueprint:plan')(planRes.reason);
    } else {
      setPlan(planRes.value);
    }
    // A refused side read leaves its field absent, which the model renders as
    // unknown - never as a policy of zero or a project nobody granted.
    const next: BlueprintSources = {
      policy: policyRes.status === 'fulfilled' ? policyRes.value : null,
      projects: projectsRes.status === 'fulfilled' ? projectsRes.value : null,
    };
    if (policyRes.status === 'rejected') silentCatch('curator:blueprint:policy')(policyRes.reason);
    if (projectsRes.status === 'rejected') silentCatch('curator:blueprint:projects')(projectsRes.reason);
    setSources(next);
    warm = { plan: planRes.status === 'fulfilled' ? planRes.value : null, sources: next };
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Her own work, landing on a page nobody is touching.
   *
   * Only the kinds that can move a row this page draws spend a read: a
   * reconcile (which supersedes the run outright) and a settle (which can write
   * a plan item to `blocked`). A dispatch moves the lane, which the console's
   * own subscription owns, and this one deliberately stays out of it.
   */
  const onPulse = useCallback(
    (pulse: { kind: string }) => {
      if (PLAN_MOVED.has(pulse.kind)) void load();
    },
    [load],
  );
  useCuratorPulse(onPulse);

  /**
   * Run the instrument and supersede the standing projection.
   *
   * `refreshing` is owned HERE rather than left to the button's own guard,
   * because two other things read it: the live region that narrates the wait,
   * and the ledger body, which says she is reading the registry instead of
   * repeating that no projection exists while one is being made.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await curatorPlanRefresh();
      setPlan(next.plan);
      warm = { plan: next.plan, sources: warm?.sources ?? {} };
      // Both facts are the BACKEND'S measurements, carried rather than
      // inferred: a stopwatch around this call is a guess at the cache, and
      // comparing against `plan` here would compare against what this page
      // happened to hold rather than against the run that was superseded.
      setOutcome({ changed: next.changed, fromCache: next.fromCache });
      // Eleven seconds is long enough for her to have taken a request off the
      // lane, so the lane is re-read rather than left showing the before.
      await reload();
    } catch (err) {
      // A run that failed answered nothing, so the last run's verdict must not
      // stand as if it were this one's.
      setOutcome(null);
      toastCatch('curator:blueprint:refresh')(err);
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const words: BlueprintWords = useMemo(
    () => ({ w: t.companions.blueprint, tx }),
    [t.companions.blueprint, tx],
  );
  // Always a model, never a null. The absence lives INSIDE it, as nulls the
  // surfaces draw as unknown, rather than outside it as a branch that swaps
  // the whole page for a card.
  const model = useMemo(
    () => (plan ? buildModel(plan, sources) : unmeasuredModel(sources)),
    [plan, sources],
  );
  // Running wins over reading: a refresh started from a warm page is the
  // instrument working, not a first read in flight.
  const phase: BlueprintPhase = refreshing ? 'running' : loading ? 'reading' : 'unrun';

  return (
    <Blueprint
      model={model}
      docket={EMPTY_DOCKET}
      words={words}
      phase={phase}
      console={
        <CuratorConsole
          loop={loop}
          policy={sources.policy ?? null}
          refreshing={refreshing}
          outcome={outcome}
          onRefresh={refresh}
        />
      }
      queue={<RequestLane requests={loop.requests} onCancel={loop.cancel} />}
    />
  );
}

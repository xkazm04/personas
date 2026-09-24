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
 * act now, and the empty state OFFERS it rather than only explaining the
 * absence - the page is not locked behind a command nobody can reach.
 *
 * The refresh costs about eleven seconds cold (it spawns up to four node
 * processes, cached five minutes on the registry's HEAD), so it is drawn as an
 * ACTION - a real spinner on the control the operator pressed - and never as a
 * surface ghost. See `console/CuratorConsole.tsx`.
 *
 * The docket ships EMPTY on purpose. There is no `curator_decisions_list` and
 * nothing writes a decision yet, so there is nothing to read; the drawer says
 * so rather than drawing a zero it did not measure.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { curatorPlanCurrent, curatorPlanRefresh, curatorPolicyGet, curatorProjectsList } from '@/api/curator';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import type { CuratorPlan } from '@/lib/bindings/CuratorPlan';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import { Blueprint } from './Blueprint';
import { ConsoleShell } from './console/ConsoleShell';
import { CuratorConsole, RunInstrument } from './console/CuratorConsole';
import { useCuratorLoop } from './console/useCuratorLoop';
import { buildModel, type BlueprintSources } from './model/buildModel';
import { EMPTY_DOCKET } from './model/docket';
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
   * Run the instrument and supersede the standing projection.
   *
   * `refreshing` is owned HERE rather than left to the button's own guard,
   * because two other things read it: the live region that narrates the wait,
   * and the empty state, which says she is reading the registry instead of
   * repeating that no projection exists while one is being made.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await curatorPlanRefresh();
      setPlan(next);
      warm = { plan: next, sources: warm?.sources ?? {} };
      // Eleven seconds is long enough for her to have taken a request off the
      // lane, so the lane is re-read rather than left showing the before.
      await reload();
    } catch (err) {
      toastCatch('curator:blueprint:refresh')(err);
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const words: BlueprintWords = useMemo(
    () => ({ w: t.companions.blueprint, tx }),
    [t.companions.blueprint, tx],
  );
  const model = useMemo(() => (plan ? buildModel(plan, sources) : null), [plan, sources]);
  const operatorConsole = (
    <CuratorConsole
      loop={loop}
      policy={sources.policy ?? null}
      refreshing={refreshing}
      onRefresh={refresh}
      run={!!model}
    />
  );

  if (model) {
    return <Blueprint model={model} docket={EMPTY_DOCKET} words={words} console={operatorConsole} />;
  }

  // No projection. The page says so - it never draws zeros - and it OFFERS the
  // run in the same block, because the absence and the thing that ends it
  // belong together. While the instrument runs, the copy says what is
  // happening rather than restating the emptiness.
  const booting = loading && !refreshing;
  return (
    <ConsoleShell words={words}>
      {operatorConsole}
      <EmptyState
        title={
          refreshing
            ? t.companions.blueprint.console.refresh_title
            : booting
              ? t.companions.blueprint.boot_title
              : t.companions.blueprint.no_plan_title
        }
        subtitle={
          refreshing
            ? t.companions.blueprint.console.refresh_body
            : booting
              ? t.companions.blueprint.boot_body
              : t.companions.blueprint.no_plan_body
        }
      >
        {!booting && <RunInstrument refreshing={refreshing} onRefresh={refresh} />}
      </EmptyState>
    </ConsoleShell>
  );
}

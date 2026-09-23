/**
 * The thin container: read the plan, build the model, hand it to the
 * primitive. Everything visual lives in `<Blueprint>`, which knows nothing
 * about IPC - that is what lets the whole page be measured in a harness.
 *
 * The docket ships EMPTY on purpose. There is no `curator_decisions_list` and
 * nothing writes a decision yet, so there is nothing to read; the drawer says
 * so rather than drawing a zero it did not measure.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { curatorPlanCurrent, curatorPolicyGet, curatorProjectsList } from '@/api/curator';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import type { CuratorPlan } from '@/lib/bindings/CuratorPlan';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import { Blueprint } from './Blueprint';
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

  const words: BlueprintWords = useMemo(
    () => ({ w: t.companions.blueprint, tx }),
    [t.companions.blueprint, tx],
  );
  const model = useMemo(() => (plan ? buildModel(plan, sources) : null), [plan, sources]);

  if (model) return <Blueprint model={model} docket={EMPTY_DOCKET} words={words} />;

  // A surface that cannot load says so; it never draws zeros. The ghost is
  // calm and delayed by the shared empty state's own chrome - no spinner, per
  // the app's loading doctrine.
  return (
    <div className="cb-root cb-boot">
      <EmptyState
        title={loading ? t.companions.blueprint.boot_title : t.companions.blueprint.no_plan_title}
        subtitle={loading ? t.companions.blueprint.boot_body : t.companions.blueprint.no_plan_body}
      />
    </div>
  );
}

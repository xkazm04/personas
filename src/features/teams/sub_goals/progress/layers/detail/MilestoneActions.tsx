/**
 * The milestone's own moves: Athena's decomposition and the cut / ship
 * certification. Both REUSE the pad's plan rather than reimplementing it -
 * `NotePlanProvider` (mounted by `MilestoneDetail` only when a brief exists)
 * owns the decompose pointer and the `ShipCertifyModal`, and the Rust mirror
 * moves the brief note when the milestone's status moves.
 *
 * Outside a provider (no brief yet) `useNotePlan()` is `null`: decompose is
 * disabled with the reason, and there is no certification to offer - a cut is
 * certified against its brief's exit criteria, and there is no brief.
 */
import { useEffect, useRef } from 'react';
import { Scissors, Rocket, Sparkles } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useNotePlan } from '@/features/notepad/plan/NotePlanContext';

import { useProgressView } from '../../canvasHost';

export function MilestoneActions({ laneStatus }: { laneStatus: string }) {
  const { dl, canvas } = useProgressView();
  const plan = useNotePlan();
  const vm = plan?.vm ?? null;
  const planStatus = vm?.status ?? null;

  // A certification lands in the plan's read first (`ShipCertifyModal` ->
  // `ship.setStatus`); the canvas lanes do not hear of it. When the two
  // disagree, re-read the lanes ONCE per plan status (the host value changes
  // identity on every busy flip, so an unguarded effect could loop).
  const reloadedFor = useRef<string | null>(null);
  const { reload } = canvas;
  useEffect(() => {
    if (!planStatus || planStatus === laneStatus || reloadedFor.current === planStatus) return;
    reloadedFor.current = planStatus;
    reload();
  }, [planStatus, laneStatus, reload]);
  // A brief exists but its milestone is still loading: hold the buttons without
  // a reason - "start a brief first" would be false.
  const planLoading = plan !== null && vm === null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="layers-detail-milestone-actions">
      <Button
        variant="accent"
        tone="agent"
        size="sm"
        icon={<Sparkles className="w-3.5 h-3.5" />}
        disabled={!vm}
        disabledReason={planLoading ? undefined : dl.layers_athena_needs_brief}
        onClick={() => plan?.decompose()}
        data-testid="layers-detail-decompose"
      >
        {dl.layers_athena_decompose}
      </Button>

      {vm && plan?.editable && vm.status === 'planned' && (
        <Button
          variant="accent"
          tone="info"
          size="sm"
          icon={<Scissors className="w-3.5 h-3.5" />}
          onClick={plan.openCertify}
          data-testid="layers-detail-cut"
        >
          {dl.layers_cut}
        </Button>
      )}

      {vm && plan?.editable && vm.status === 'active' && (
        <Button
          variant="accent"
          tone="success"
          size="sm"
          icon={<Rocket className="w-3.5 h-3.5" />}
          disabled={plan.verdict !== 'go'}
          disabledReason={dl.layers_ship_gated}
          onClick={plan.openCertify}
          data-testid="layers-detail-ship"
        >
          {dl.layers_ship}
        </Button>
      )}
    </div>
  );
}

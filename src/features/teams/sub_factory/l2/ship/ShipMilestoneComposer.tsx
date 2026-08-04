// The milestone composer (wired): the scale-ready library tree on the left
// (ShipLibraryTree — group bands, search, quick-add, context drawer), the
// milestone's live core cut on the right. Every add / remove is a
// dev_milestone_items write; the derived footprint re-computes in useShipData
// on refetch. This surface also hosts the LLM assist path: goals can be
// authored context-less (shared GoalEditorModal) and handed to an agent via
// the universal DispatchChooser (Dev runner / Fleet / CLI) to categorize,
// execute, and flag the milestone item for manual review.
import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, Target, X, Zap } from 'lucide-react';

import { DispatchChooserModal } from '@/features/shared/dispatch/DispatchChooser';
import { GoalEditorModal } from '@/features/teams/sub_goals/GoalEditorModal';
import { useTranslation } from '@/i18n/useTranslation';

import { INK } from '../../passport/passportInk';
import { buildGoalAssistPrompt } from './ShipDispatch';
import { ShipContextDrawer } from './ShipContextDrawer';
import { ShipItemAnnotations } from './ShipItemAnnotations';
import { ShipLibraryTree } from './ShipLibraryTree';
import { TONE_HUE_MAP, type ShipContext, type ShipGoal, type ShipMilestoneVM } from './shipModel';
import { LedgerEmpty, LedgerHeader, LedgerList, LedgerRow } from './shipRows';
import type { ShipData } from './useShipData';

const iconBtn = (hue: string) => ({
  className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring shrink-0',
  style: { color: hue, borderColor: `${hue}55` },
} as const);

export function ShipMilestoneComposer({ vm, ship, onBack }: {
  vm: ShipMilestoneVM;
  ship: ShipData;
  onBack: () => void;
}) {
  const { t, tx } = useTranslation();
  const [drawerCtx, setDrawerCtx] = useState<ShipContext | null>(null);
  const [goalModal, setGoalModal] = useState(false);
  const [assistGoal, setAssistGoal] = useState<ShipGoal | null>(null);
  const cut = vm.members.filter((m) => m.bucket === 'core');

  return (
    <div data-testid="factory-ship-composer">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring rounded-interactive mb-3">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
        {t.ship.back_to_plan}
      </button>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(0, 1.25fr)' }}>
        {/* LEFT — the project library */}
        <div className="min-w-0 rounded-modal border border-foreground/[0.08] p-3" style={{ background: 'rgba(148,163,184,.02)' }}>
          <ShipLibraryTree
            ship={ship}
            vm={vm}
            onOpenContext={setDrawerCtx}
            onNewGoal={() => setGoalModal(true)}
            onAssistGoal={setAssistGoal}
          />
        </div>

        {/* RIGHT — the live cut for THIS milestone */}
        <div className="min-w-0">
          <p className="typo-title-lg mb-1">{tx(t.ship.composing_title, { name: vm.name })}</p>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            {vm.boundGoals.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption" style={{ borderColor: `${INK.teal}55`, color: INK.teal }}>
                <Target className="w-3 h-3" aria-hidden />
                {g.name}
                <button type="button" onClick={() => setAssistGoal(g)} className="focus-ring rounded-full" title={t.ship.goal_assist_tooltip} aria-label={tx(t.ship.goal_assist_aria, { name: g.name })}>
                  <Zap className="w-3 h-3" style={{ color: INK.violet }} aria-hidden />
                </button>
                <button type="button" onClick={() => ship.removeItem(vm.id, 'goal', g.id)} className="focus-ring rounded-full" aria-label={tx(t.ship.unbind_aria, { name: g.name })}>
                  <X className="w-3 h-3 opacity-60 hover:opacity-100" aria-hidden />
                </button>
              </span>
            ))}
            {/* Only point at the library when it can actually deliver. */}
            {vm.boundGoals.length === 0 && ship.goals.length > 0 && (
              <span className="typo-caption" style={{ color: INK.blue }}>{t.ship.no_objective_hint}</span>
            )}
            {vm.boundGoals.length === 0 && ship.goals.length === 0 && (
              <button type="button" onClick={() => setGoalModal(true)} className="typo-caption text-foreground/45 hover:text-foreground/75 transition-colors focus-ring rounded-interactive">
                {t.ship.no_goals_cta}
              </button>
            )}
          </div>

          <div className="rounded-card px-3 py-2 mb-3 border border-foreground/[0.07]" style={{ background: 'rgba(148,163,184,.03)' }} data-testid="ship-footprint">
            <span className="typo-caption block mb-1.5">
              {tx(t.ship.footprint_label, { count: vm.footprint.length })}
              {vm.footprint.filter((c) => c.tone === 'crit').length > 0 && <span style={{ color: INK.red }}>{tx(t.ship.footprint_critical, { count: vm.footprint.filter((c) => c.tone === 'crit').length })}</span>}
              {vm.footprint.filter((c) => c.kpis === 0).length > 0 && <span style={{ color: INK.blue }}>{tx(t.ship.footprint_no_kpi, { count: vm.footprint.filter((c) => c.kpis === 0).length })}</span>}
            </span>
            <span className="flex items-center gap-1.5 flex-wrap">
              {vm.footprint.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs" style={{ borderColor: `${TONE_HUE_MAP[c.tone]}55`, color: TONE_HUE_MAP[c.tone] }} title={`${c.kpis} KPIs`}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE_HUE_MAP[c.tone] }} />
                  {c.name}{c.kpis === 0 ? ` · ${t.ship.no_kpi_short}` : ''}
                </span>
              ))}
              {vm.footprint.length === 0 && <span className="typo-caption">{t.ship.footprint_empty}</span>}
            </span>
          </div>

          <LedgerHeader title={t.ship.the_cut} count={cut.length} aside={t.ship.the_cut_aside} />
          <LedgerList testid="ship-compose-cut">
            {cut.map((m, i) => (
              <LedgerRow
                key={m.feature.id}
                index={i}
                name={m.feature.name}
                contexts={m.feature.contexts}
                stateLabel={m.feature.kpiCount > 0
                  ? tx(m.feature.kpiCount === 1 ? t.ship.kpi_count_one : t.ship.kpi_count_other, { count: m.feature.kpiCount })
                  : t.ship.state_no_kpi}
                stateHue={m.feature.kpiCount > 0 ? INK.emerald : INK.blue}
                meta={m.afterCut ? <span className="typo-caption shrink-0" style={{ color: INK.violet }}>{t.ship.added_after_cut}</span> : undefined}
                footer={(
                  <ShipItemAnnotations
                    member={m}
                    editable={vm.status !== 'shipped'}
                    onPatch={(patch) => ship.setItem(vm.id, 'use_case', m.feature.id, m.bucket, patch)}
                  />
                )}
                actions={
                  <button type="button" onClick={() => ship.removeItem(vm.id, 'use_case', m.feature.id)} {...iconBtn('rgba(148,163,184,.7)')} aria-label={tx(t.ship.remove_aria, { name: m.feature.name })}>
                    <X className="w-3 h-3" aria-hidden />
                    {t.ship.remove}
                  </button>
                }
              />
            ))}
            {cut.length === 0 && (
              <LedgerEmpty testid="ship-compose-cut-empty">
                {ship.contexts.length === 0 ? t.ship.cut_empty_unscanned : t.ship.cut_empty_scanned}
              </LedgerEmpty>
            )}
          </LedgerList>
        </div>
      </div>

      {/* the context detail drawer (ContextDetail pattern, Ship-local data) */}
      <AnimatePresence>
        {drawerCtx && (
          <ShipContextDrawer
            ctx={drawerCtx}
            groupName={ship.groups.find((g) => g.id === drawerCtx.groupId)?.name ?? null}
            vm={vm}
            ship={ship}
            onClose={() => setDrawerCtx(null)}
          />
        )}
      </AnimatePresence>

      {/* context-less goal authoring — the shared editor from sub_goals */}
      {ship.project && (
        <GoalEditorModal
          isOpen={goalModal}
          onClose={() => setGoalModal(false)}
          projectId={ship.project.id}
          onSaved={ship.reload}
        />
      )}

      {/* the universal dispatch chooser carrying the goal-assist brief */}
      {assistGoal && ship.project && (
        <DispatchChooserModal
          request={{
            title: tx(t.ship.goal_assist_title, { name: assistGoal.name }),
            prompt: buildGoalAssistPrompt(assistGoal, vm, ship.project),
            target: { projectId: ship.project.id, projectName: ship.project.name, rootPath: ship.project.root_path },
            fleetKey: `passport:ship-goal-${assistGoal.id.slice(0, 8)}:${ship.project.id}`,
          }}
          onClose={() => setAssistGoal(null)}
          onDispatched={() => setAssistGoal(null)}
        />
      )}
    </div>
  );
}

// The note AS a plan.
//
// One surface, two halves, and the split is the whole argument: on the left the
// BRIEF he wrote, on the right the SCOPE it produced. The Ship tab could only
// ever show the second — the brief lived in a `description` column and was
// edited in a field beside the ledger it explains — and the pad could only ever
// show the first. Neither surface could answer "does the cut match what I said I
// was doing", which is the question the whole milestone exists to keep asking.
//
// The brief stays EDITABLE while the plan is scoped or cut (the server agrees —
// a note's body is writable in `draft | scoped | cut`), because a brief that
// freezes the moment the scope is named is a brief nobody updates. It goes
// read-only at `shipped`, where the note stops being a plan and becomes the
// record of one.
import { useEffect, useState } from 'react';

import { MarkdownMiniEditor } from '@/features/shared/components/editors/MarkdownMiniEditor';
import { Badge } from '@/features/shared/components/display/Badge';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import { NoteHeader } from '../parts/NoteHeader';
import type { NoteBodyProps } from '../types';
import { useNotePlan, type PlanTab } from './NotePlanContext';
import { NotePlanLedger } from './NotePlanLedger';
import { NotePlanRuns } from './NotePlanRuns';
import { publishShipReadiness } from './shipReadinessPublish';
import { ShipCriteriaList } from './ShipCriteriaPanel';
import { ShipMilestoneComposer } from './ShipMilestoneComposer';
import { ShipDualitySummary, ShipGoalField } from './ShipMilestoneMeta';
import { ShipVelocityNote } from './ShipVelocityNote';

/** The verdict's `Badge` variant. It used to be paired with an inline
 *  `style={{ color: CRIT_HUE[verdict] }}` on the text inside, which set the same
 *  colour the variant already sets — as a hex, so on a light theme it set the
 *  dark-theme one. The variant alone carries both the shape and the verdict. */
const VERDICT_VARIANT = {
  go: 'emerald',
  warn: 'amber',
  nogo: 'red',
  setup: 'blue',
} as const;

/** Geometry-matched ghost for the scope half — under the pane's permanent
 *  chrome, never instead of it, and never a spinner (this is a surface loading
 *  its data). */
function ScopeGhost() {
  return (
    <div className="flex flex-col gap-2" aria-hidden data-testid="note-plan-ghost">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 rounded-card bg-secondary/25" />
      ))}
    </div>
  );
}

export function NotePlanPane({ note, onPatch, readOnly }: NoteBodyProps) {
  const { t, tx } = useTranslation();
  const plan = useNotePlan();
  // The tab lives on the context, not here: the HOST drives it from `Ctrl+1/2/3`
  // and the host is this component's grandparent. The fallback pair covers a
  // render outside the provider — which the Factory's Ship tab used to do until
  // it was retired on 2026-09-15, and which the pane's own tests still do — and
  // keeps this component from having to be two components.
  const tab: PlanTab = plan?.tab ?? 'plan';
  const setTab = plan?.setTab ?? (() => {});
  const [composing, setComposing] = useState(false);

  // Publish what THIS pane derived so `describe_ship_milestone` can serve it.
  // The exit criteria and the ship verdict are computed here from signals SQLite
  // cannot reproduce (per-context Sentry counts, bound credentials). The whole
  // roadmap, not the selected milestone: being on one note's plan must not
  // narrow what Athena can answer about the project. Debounced and deduped in
  // the publisher, so an unchanged roadmap costs no IPC.
  const roadmap = plan?.ship.roadmap;
  useEffect(() => {
    if (roadmap) publishShipReadiness(roadmap);
  }, [roadmap]);

  const vm = plan?.vm ?? null;
  const editable = Boolean(plan?.editable);

  const tabs = [
    { id: 'plan' as const, label: t.notepad.plan_tab_plan },
    { id: 'criteria' as const, label: t.notepad.plan_tab_criteria },
    { id: 'runs' as const, label: t.notepad.plan_tab_runs },
  ];

  return (
    // Stacks below 1100px: two ledgers side by side in a 900px window leaves
    // neither readable, and the brief is the half that suffers first.
    <div
      className="flex-1 min-h-0 flex flex-col max-[1100px]:overflow-y-auto min-[1100px]:flex-row"
      data-testid="note-plan-pane"
    >
      {/* THE BRIEF */}
      <div className="min-w-0 flex flex-col gap-4 px-6 py-5 min-[1100px]:w-[38%] min-[1100px]:flex-shrink-0 min-[1100px]:overflow-y-auto min-[1100px]:border-r min-[1100px]:border-primary/10">
        <NoteHeader note={note} onRename={(title) => onPatch({ title })} readOnly={readOnly} />

        {readOnly && (
          <p className="typo-caption text-status-warning/80 border-l-2 border-status-warning/30 pl-3">
            {t.notepad.plan_shipped_notice}
          </p>
        )}

        <MarkdownMiniEditor
          value={note.bodyMd}
          onChange={(bodyMd) => onPatch({ bodyMd })}
          readOnly={readOnly}
          toolbar={!readOnly}
          preview="toggle"
          rows={18}
          ariaLabel={t.notepad.editor_label}
          placeholder={t.notepad.editor_placeholder}
          testId="notepad-body-plan"
          containerClassName="flex-1 min-h-0 flex flex-col gap-3"
          className="flex-1 min-h-[32vh] w-full resize-none rounded-card border border-primary/12 bg-secondary/15 px-4 py-3 typo-body leading-relaxed text-foreground/90 placeholder:text-foreground/60 outline-none focus:border-primary/25"
          previewClassName="flex-1 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-secondary/10 px-4 py-3"
        />
      </div>

      {/* THE SCOPE */}
      <div className="min-w-0 flex-1 flex flex-col px-6 py-5 min-[1100px]:overflow-y-auto">
        {/* Permanent chrome: rendered whether or not the milestone has loaded,
            and whether or not it still exists. */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {vm ? (
                <ShipGoalField
                  name={vm.name}
                  goal={vm.goal}
                  editable={editable}
                  onSave={(goal) => plan?.ship.setGoal(vm.id, goal)}
                />
              ) : (
                <p className="typo-title text-foreground/60">{t.notepad.plan_milestone_loading}</p>
              )}
            </div>
            {vm && plan && (
              <Badge variant={VERDICT_VARIANT[plan.verdict]} size="sm">
                {tx(t.notepad.plan_verdict_badge, {
                  met: plan.totalCriteria - plan.unmet,
                  total: plan.totalCriteria,
                })}
              </Badge>
            )}
          </div>

          {vm?.targetLabel && (
            <p className="typo-caption text-foreground/70" data-testid="note-plan-target">{vm.targetLabel}</p>
          )}
          {vm && plan && <ShipVelocityNote rows={plan.ship.roadmap.map((ms) => ms.row)} vm={vm} />}
          {vm && <ShipDualitySummary duality={vm.duality} />}
        </div>

        <SegmentedTabs
          tabs={tabs}
          activeTab={tab}
          onTabChange={setTab}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel={t.notepad.plan_tabs_label}
          className="mb-4"
          idPrefix="note-plan"
        />

        {/* THREE STATES, in the doctrine's order: ghost only while nothing has
            painted; the "gone" reading when the link outlived its milestone;
            otherwise the tab. The region is the PANEL the tablist above
            controls — ids match `SegmentedTabs`' `${idPrefix}-tab-…` /
            `${idPrefix}-panel-…` scheme, so the relationship the strip
            advertises exists in the tree and not only in the layout. */}
        <div
          role="tabpanel"
          id={`note-plan-panel-${tab}`}
          aria-labelledby={`note-plan-tab-${tab}`}
          className="min-w-0 flex-1 flex flex-col"
        >
        {plan?.loading ? (
          <ScopeGhost />
        ) : !vm || !plan ? (
          <p className="typo-caption text-status-warning/80 rounded-card border border-dashed border-status-warning/30 px-3 py-4 text-center" data-testid="note-plan-missing">
            {t.notepad.plan_milestone_missing}
          </p>
        ) : tab === 'plan' ? (
          composing ? (
            <ShipMilestoneComposer vm={vm} ship={plan.ship} onBack={() => setComposing(false)} />
          ) : (
            <NotePlanLedger vm={vm} ship={plan.ship} editable={editable} t={t} tx={tx} />
          )
        ) : tab === 'criteria' ? (
          // `ShipCriteriaList` owns its own dispatch + terminal modals, so the
          // editable-prompt-before-spawn flow comes with it unchanged.
          <ShipCriteriaList vm={vm} project={plan.ship.project} />
        ) : (
          <NotePlanRuns
            noteId={note.id}
            onCompose={() => { setTab('plan'); setComposing(true); }}
          />
        )}
        </div>

        {/* Compose is a verb ON the ledger, so it sits with it rather than in
            the note's dispatch bar — that bar is where the note LEAVES the pad,
            and composing scope never leaves anything. */}
        {vm && editable && tab === 'plan' && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="self-start mt-4 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption border border-primary/20 text-foreground/80 transition-colors hover:bg-secondary/40 focus-ring"
            data-testid="note-plan-compose"
          >
            {t.ship.compose_scope}
          </button>
        )}
      </div>
    </div>
  );
}

// The blocks that open the surface: who this goal is, what outcome it steers,
// and the one decision waiting on the user.
//
// Each reads the shared model, so a layout places them without wiring.
//
// `Identity` lived here until 2026-10-06 and is gone: the goal's icon, title,
// status, percent and window controls are now the HEADER of `ModalShell`, which
// owns those type tiers for every modal in the app rather than for this one.
import { Activity, BadgeCheck, Check } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { MODAL_SECTION_HEAD } from '@/features/shared/components/modals';

import { GoalKpiLink } from '../../GoalKpiLink';
import { AcceptRejectControls } from '../../acceptancePrimitives';
import { useGoalDetailModel } from '../context';

/** The goal's prose. Deliberately width-capped: a description is reading matter,
 *  and a 1200px line is worse than a 700px one however much room the modal has. */
export function Description() {
  const { goal } = useGoalDetailModel();
  if (!goal?.description) return null;
  return (
    <div className="rounded-card border border-primary/10 bg-card/30 px-3.5 py-3">
      <RichMarkdown content={goal.description} className="typo-body max-w-[68ch]" />
    </div>
  );
}

/**
 * The outcome this goal steers. When a KPI is linked, lead with it (read-only
 * projection; stays silent if the KPI was archived). When none is, say so
 * honestly: the progress below is checklist activity, not a measured outcome
 * (UAT P9 F-GOALS-PLACEBO).
 */
export function Outcome() {
  const { goal, t } = useGoalDetailModel();
  if (!goal) return null;
  if (goal.kpi_id) return <GoalKpiLink kpiId={goal.kpi_id} />;
  return (
    <div className="rounded-card border border-status-warning/25 bg-status-warning/5 px-3.5 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-status-warning shrink-0" />
        <span className={MODAL_SECTION_HEAD}>{t.kpis.goal_ungrounded_title}</span>
      </div>
      <p className="typo-caption text-foreground">{t.kpis.goal_ungrounded_body}</p>
    </div>
  );
}

/**
 * The acceptance gate - the agent/team finished; the user accepts (-> done, off
 * the board) or sends it back with a comment. Shown instead of the hand-off
 * panel while pending, and it is the single most important thing on the surface
 * when it is up, which is why every variant gives it full width.
 */
export function AcceptanceGate() {
  const { awaitingAcceptance, accept, reject, dl } = useGoalDetailModel();
  if (!awaitingAcceptance) return null;
  return (
    <div className="rounded-card bg-status-success/10 px-4 py-3">
      <div className="flex items-center gap-2 mb-2.5">
        <BadgeCheck className="w-4 h-4 text-status-success shrink-0" />
        <span className="typo-title">{dl.goal_status_awaiting_acceptance}</span>
      </div>
      <AcceptRejectControls onAccept={accept} onReject={reject} />
    </div>
  );
}

/** The hybrid progress nudge: the engine's suggestion, never applied silently. */
export function ProgressNudge() {
  const { showNudge, progress, goal, acceptProgress, dl } = useGoalDetailModel();
  if (!showNudge || !progress || !goal) return null;
  return (
    <div className="rounded-card border border-primary/25 bg-primary/5 px-4 py-3 flex items-center gap-3">
      <Activity className="w-4 h-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="typo-body text-foreground">
          {dl.goal_progress_suggested_label}{' '}
          <span className="font-semibold text-primary tabular-nums">{progress.suggested}%</span>
          {/* The original glyph, restored: " to " is hardcoded English, an
              arrow is not language at all. */}
          <span className="text-foreground"> ({goal.progress}% → {progress.suggested}%)</span>
        </p>
        <p className="typo-caption text-foreground">{progress.reason}</p>
      </div>
      <Button variant="accent" tone="agent" size="sm" icon={<Check className="w-3.5 h-3.5" />} onClick={acceptProgress}>
        {dl.goal_progress_accept}
      </Button>
    </div>
  );
}

/** The in-flight line. `LoadingSpinner` renders nothing app-wide; the text is
 *  the whole signal, and it sits above content rather than replacing it. */
export function RefreshingLine() {
  const { loading, t } = useGoalDetailModel();
  if (!loading) return null;
  return (
    <div className="flex items-center gap-2 typo-caption text-foreground">
      <LoadingSpinner size="sm" /> {t.common.loading}
    </div>
  );
}

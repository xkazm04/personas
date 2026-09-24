/**
 * The plan behind the questions, one layer down: what it is trying to learn
 * about the person (goals by phase, with coverage), what it will ask next,
 * what it has noticed, and what the last re-plan changed — plus the person's
 * moves over it: pin, drop, restore, "ask this next", rebuild.
 *
 * The plan STEERS; it never decides that a slot is done. That stays with
 * readiness, which is why nothing here reads as a checklist.
 *
 * Loading pattern v2: the frame and its header are always there; while the
 * plan is being drawn up and has no goals yet, a calm ghost sits under the
 * header. Never a spinner on the surface — the only spinners are on the
 * buttons the person presses (AsyncButton).
 */

import { RotateCcw, Route } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import { SETUP_FOCUS_ORDER, type SetupSessionApi } from '../../setup/setupContract';
import { TRAINING_TOPIC_PRESETS } from '../../sub_training/topicPresets';
import { LayerFrame } from './LayerFrame';
import { PlanGoalRow } from './PlanGoalRow';

/** How many queued questions "Up next" shows. */
const UP_NEXT = 3;
const TRAINING_PREFIX = 'training:';

interface PlanLayerProps {
  open: boolean;
  onClose: () => void;
  session: Pick<SetupSessionApi, 'plan' | 'planning' | 'steer' | 'rebuild'>;
}

/** Live goals in plan order, then the dropped ones — struck through, at the end. */
function ordered(goals: SetupGoal[], rank: (g: SetupGoal) => number): SetupGoal[] {
  return [...goals].sort(
    (a, b) =>
      Number(a.state === 'dropped') - Number(b.state === 'dropped') ||
      rank(a) - rank(b) ||
      a.position - b.position,
  );
}

export function PlanLayer({ open, onClose, session }: PlanLayerProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience.plan;
  const { plan, planning, steer, rebuild } = session;
  const goals = plan?.goals ?? [];

  const slotRank = (g: SetupGoal) => SETUP_FOCUS_ORDER.findIndex((s) => s === g.slot);
  const setupGoals = ordered(goals.filter((g) => slotRank(g) >= 0), slotRank);
  const trainingGoals = ordered(
    goals.filter((g) => g.slot.startsWith(TRAINING_PREFIX)),
    (g) => TRAINING_TOPIC_PRESETS.findIndex((p) => `${TRAINING_PREFIX}${p.id}` === g.slot),
  );
  const labelOf = (g: SetupGoal) => {
    const slot = SETUP_FOCUS_ORDER.find((s) => s === g.slot);
    if (slot) return t.twin.experience.slots[slot].label;
    const preset = TRAINING_TOPIC_PRESETS.find((p) => `${TRAINING_PREFIX}${p.id}` === g.slot);
    return preset ? t.twin.training[preset.labelKey] : tx.phaseTraining;
  };

  const onPin = (g: SetupGoal, pinned: boolean) => steer({ action: 'pinGoal', goalId: g.id, pinned });
  const onDrop = (g: SetupGoal) => steer({ action: 'dropGoal', goalId: g.id });
  const onRestore = (g: SetupGoal) => steer({ action: 'restoreGoal', goalId: g.id });

  const status = plan?.status === 'failed' ? 'failed' : planning || plan?.status !== 'ready' ? 'building' : 'ready';
  const ghost = goals.length === 0 && (planning || plan === null);

  const phase = (title: string, list: SetupGoal[], testId: string) =>
    list.length > 0 && (
      <section className="space-y-2" data-testid={testId}>
        <h4 className="typo-label text-foreground">{title}</h4>
        <ul className="space-y-1.5">
          {list.map((g) => (
            <PlanGoalRow key={g.id} goal={g} slotLabel={labelOf(g)} onPin={onPin} onDrop={onDrop} onRestore={onRestore} />
          ))}
        </ul>
      </section>
    );

  return (
    <LayerFrame
      open={open}
      onClose={onClose}
      icon={<Route className="w-4 h-4" />}
      title={tx.title}
      hint={tx.hint}
      testId="mr-plan"
    >
      <div className="px-5 py-4 space-y-5">
        <div className="flex flex-wrap items-center gap-3" data-testid="mr-plan-status" data-status={status}>
          <p className={`typo-body flex-1 min-w-[12rem] ${status === 'failed' ? 'text-status-warning' : 'text-foreground'}`}>
            {status === 'failed' ? tx.statusFailed : status === 'ready' ? tx.statusReady : tx.statusBuilding}
          </p>
          {status === 'failed' && (
            <AsyncButton variant="secondary" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={rebuild} data-testid="mr-plan-retry">
              {tx.retry}
            </AsyncButton>
          )}
        </div>

        {plan?.changeNote && (
          <div className="rounded-card border border-primary/15 bg-secondary/30 px-3 py-2" data-testid="mr-plan-change">
            <p className="typo-caption text-primary">{tx.changeNote}</p>
            <p className="typo-body text-foreground">{plan.changeNote}</p>
          </div>
        )}

        {ghost ? (
          <div aria-hidden className="space-y-2" data-testid="mr-plan-ghost">
            {[0, 1, 2].map((n) => (
              <span key={n} className="block h-14 rounded-card bg-secondary/40" />
            ))}
          </div>
        ) : goals.length === 0 ? (
          <p className="typo-caption" data-testid="mr-plan-empty">{tx.empty}</p>
        ) : (
          <>
            {phase(tx.phaseSetup, setupGoals, 'mr-plan-phase-setup')}
            {phase(tx.phaseTraining, trainingGoals, 'mr-plan-phase-training')}
          </>
        )}

        {plan && plan.upcoming.length > 0 && (
          <section className="space-y-2" data-testid="mr-plan-upnext">
            <h4 className="typo-label text-foreground">{tx.upNext}</h4>
            <ol className="space-y-1.5">
              {plan.upcoming.slice(0, UP_NEXT).map((step) => (
                <li key={step.id} className="flex items-start gap-2 rounded-card border border-primary/10 px-3 py-2">
                  <p className="typo-body text-foreground flex-1 min-w-0">{step.question}</p>
                  <AsyncButton
                    variant="ghost"
                    size="xs"
                    onClick={() => steer({ action: 'askNext', stepId: step.id })}
                    data-testid={`mr-plan-asknext-${step.id}`}
                  >
                    {tx.askNext}
                  </AsyncButton>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="space-y-2" data-testid="mr-plan-noticed">
          <h4 className="typo-label text-foreground">{tx.noticed}</h4>
          {plan && plan.observations.length > 0 ? (
            <ul className="space-y-1 list-disc pl-5">
              {plan.observations.map((o) => (
                <li key={o.id} className="typo-body text-foreground">{o.text}</li>
              ))}
            </ul>
          ) : (
            <p className="typo-caption">{tx.noticedEmpty}</p>
          )}
        </section>

        <div className="pt-2 border-t border-primary/10">
          <AsyncButton variant="secondary" size="sm" icon={<Route className="w-3.5 h-3.5" />} onClick={rebuild} loadingText={tx.rebuilding} data-testid="mr-plan-rebuild">
            {tx.rebuild}
          </AsyncButton>
        </div>
      </div>
    </LayerFrame>
  );
}

export default PlanLayer;

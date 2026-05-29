/**
 * GoalsAttention — the cross-project "needs you" queue (Goals v2 L2 "Attention").
 *
 * One ranked list of everything that wants the user across all projects:
 * awaiting-review team steps (resolve inline), overdue, stalled, and unstaffed
 * goals. Each row opens the goal (via the active-project + spotlight handoff) or,
 * for awaiting-review, skips/aborts the step directly. A header button hands the
 * whole queue to Athena for batch triage. Backed by `dev_tools_attention_queue`.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Clock, UserPlus, SkipForward, Ban, Maximize2, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { attentionQueue } from '@/api/devTools/devTools';
import { resolveTeamAssignmentReview } from '@/api/pipeline/assignments';
import type { AttentionQueue } from '@/lib/bindings/AttentionQueue';
import type { AttentionItem } from '@/lib/bindings/AttentionItem';
import { GoalStatusBadge } from './GoalStatusBadge';
import { GoalAtmosphere } from './goalsTheme';

type KindKey = 'awaiting_review' | 'overdue' | 'stalled' | 'unstaffed';

const KIND_META: Record<KindKey, { icon: typeof Clock; chip: string; edge: string; labelKey: 'attention_kind_awaiting_review' | 'attention_kind_overdue' | 'attention_kind_stalled' | 'attention_kind_unstaffed' }> = {
  awaiting_review: { icon: AlertTriangle, chip: 'text-amber-400 border-amber-500/25 bg-amber-500/10', edge: '#F59E0B', labelKey: 'attention_kind_awaiting_review' },
  overdue: { icon: Clock, chip: 'text-red-400 border-red-500/25 bg-red-500/10', edge: '#EF4444', labelKey: 'attention_kind_overdue' },
  stalled: { icon: Clock, chip: 'text-orange-400 border-orange-500/25 bg-orange-500/10', edge: '#FB923C', labelKey: 'attention_kind_stalled' },
  unstaffed: { icon: UserPlus, chip: 'text-sky-400 border-sky-500/25 bg-sky-500/10', edge: '#38BDF8', labelKey: 'attention_kind_unstaffed' },
};

export function GoalsAttention() {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [queue, setQueue] = useState<AttentionQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  const refresh = useCallback(() => {
    setLoading(true);
    attentionQueue()
      .then(setQueue)
      .catch(silentCatch('GoalsAttention.queue'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Open a (possibly cross-project) goal: switch the active project, arm the
  // spotlight handoff, then route to the Board, which consumes it and opens the drawer.
  const openGoal = (item: AttentionItem) => {
    setActiveProject(item.projectId);
    setPendingGoalSpotlightId(item.goalId);
    setGoalsTab('board');
  };

  const resolveStep = async (stepId: string, action: 'skip' | 'abort') => {
    try {
      await resolveTeamAssignmentReview(stepId, { action });
      refresh();
    } catch (err) {
      toastCatch('Failed to resolve step')(err);
    }
  };

  const askAthena = () => {
    useCompanionStore.getState().setPendingPrompt({ text: dl.attention_ask_athena_prompt, autoSend: true });
    useCompanionStore.getState().setState('open');
  };

  if (loading) {
    return <div className="flex justify-center py-16"><LoadingSpinner size="md" /></div>;
  }

  if (!queue || queue.items.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center py-16 text-center">
        <GoalAtmosphere className="[background:radial-gradient(120%_70%_at_50%_-10%,rgba(16,185,129,0.08),transparent_55%)]" />
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-4 animate-fade-scale-in">
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        </div>
        <h3 className="typo-section-title text-foreground">{dl.attention_all_clear}</h3>
        <p className="typo-body text-foreground mt-1 max-w-md">{dl.attention_all_clear_sub}</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-4 pb-6">
      <GoalAtmosphere />
      {/* Header: counts + triage */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <CountChip n={queue.awaitingReview} kind="awaiting_review" label={dl.attention_kind_awaiting_review} />
          <CountChip n={queue.overdue} kind="overdue" label={dl.attention_kind_overdue} />
          <CountChip n={queue.stalled} kind="stalled" label={dl.attention_kind_stalled} />
          <CountChip n={queue.unstaffed} kind="unstaffed" label={dl.attention_kind_unstaffed} />
        </div>
        <Button variant="secondary" size="sm" icon={<Sparkles className="w-3.5 h-3.5" />} onClick={askAthena}>
          {dl.attention_ask_athena}
        </Button>
      </div>

      {/* Ranked rows */}
      <ul className="space-y-1.5">
        {queue.items.map((item, i) => {
          const meta = KIND_META[item.kind as KindKey] ?? KIND_META.overdue;
          const Icon = meta.icon;
          return (
            <li
              key={`${item.kind}-${item.goalId}-${item.stepId ?? i}`}
              style={{ boxShadow: `inset 3px 0 0 0 ${meta.edge}`, animationDelay: `${Math.min(i, 12) * 35}ms` }}
              className="animate-fade-slide-in flex items-center gap-3 rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 pl-4 pr-3 py-2.5 transition-[border-color] duration-200 hover:border-primary/25"
            >
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1 ${meta.chip}`}>
                <Icon className="w-3 h-3" /> {dl[meta.labelKey]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="typo-body text-foreground truncate">{item.goalTitle}</p>
                <p className="typo-caption text-foreground truncate">
                  {item.projectName}{item.detail ? ` · ${item.detail}` : ''}
                </p>
              </div>
              <GoalStatusBadge status={item.status} />
              <div className="flex items-center gap-1 shrink-0">
                {item.kind === 'awaiting_review' && item.stepId ? (
                  <>
                    <Button variant="ghost" size="icon-sm" title={dl.attention_resolve_skip} onClick={() => resolveStep(item.stepId!, 'skip')}>
                      <SkipForward className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title={dl.attention_resolve_abort} onClick={() => resolveStep(item.stepId!, 'abort')}>
                      <Ban className="w-3.5 h-3.5 text-red-400" />
                    </Button>
                  </>
                ) : null}
                <Button variant="ghost" size="icon-sm" title={dl.attention_open_goal} onClick={() => openGoal(item)}>
                  <Maximize2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CountChip({ n, kind, label }: { n: number; kind: KindKey; label: string }) {
  const meta = KIND_META[kind];
  const muted = n === 0;
  return (
    <span className={`typo-caption font-medium px-2 py-1 rounded-full border tabular-nums ${muted ? 'text-foreground border-primary/15 bg-primary/5 opacity-60' : meta.chip}`}>
      {n} {label}
    </span>
  );
}

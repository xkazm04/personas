/**
 * GoalAttentionDrawer — a project's "needs you" queue as a right-edge slide-over.
 *
 * Replaces the standalone Attention L2 tab: Portfolio surfaces a per-project
 * "N need attention" button (from the cross-project `attention_queue`, grouped
 * client-side), and clicking it opens this drawer scoped to that project. Rows
 * carry the same inline skip/abort (awaiting-review) + open-goal actions the old
 * tab had. Items are passed in already-filtered, so the drawer does no fetching;
 * `onResolved` lets the parent refresh after an inline resolution.
 */
import { AlertTriangle, Clock, UserPlus, SkipForward, Ban, Maximize2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';
import { resolveTeamAssignmentReview } from '@/api/pipeline/assignments';
import type { AttentionItem } from '@/lib/bindings/AttentionItem';
import { GoalStatusBadge } from './GoalStatusBadge';

type KindKey = 'awaiting_review' | 'overdue' | 'stalled' | 'unstaffed';

const KIND_META: Record<KindKey, { icon: typeof Clock; chip: string; edge: string; labelKey: 'attention_kind_awaiting_review' | 'attention_kind_overdue' | 'attention_kind_stalled' | 'attention_kind_unstaffed' }> = {
  awaiting_review: { icon: AlertTriangle, chip: 'text-amber-400 border-amber-500/25 bg-amber-500/10', edge: '#F59E0B', labelKey: 'attention_kind_awaiting_review' },
  overdue: { icon: Clock, chip: 'text-red-400 border-red-500/25 bg-red-500/10', edge: '#EF4444', labelKey: 'attention_kind_overdue' },
  stalled: { icon: Clock, chip: 'text-orange-400 border-orange-500/25 bg-orange-500/10', edge: '#FB923C', labelKey: 'attention_kind_stalled' },
  unstaffed: { icon: UserPlus, chip: 'text-sky-400 border-sky-500/25 bg-sky-500/10', edge: '#38BDF8', labelKey: 'attention_kind_unstaffed' },
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  items: AttentionItem[];
  /** Called after an inline resolve so the parent can refresh its queue. */
  onResolved: () => void;
}

export function GoalAttentionDrawer({ isOpen, onClose, projectName, items, onResolved }: Props) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  const openGoal = (item: AttentionItem) => {
    setActiveProject(item.projectId);
    setPendingGoalSpotlightId(item.goalId);
    setGoalsTab('board');
    onClose();
  };

  const resolveStep = async (stepId: string, action: 'skip' | 'abort') => {
    try {
      await resolveTeamAssignmentReview(stepId, { action });
      onResolved();
    } catch (err) {
      toastCatch('Failed to resolve step')(err);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="goal-attention-drawer-title"
      placement="right-drawer"
      maxWidthClass="max-w-md"
      panelClassName="bg-background border-l border-primary/10 shadow-elevation-4 h-full flex flex-col"
      staggerChildren={false}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-primary/10">
        <div className="min-w-0">
          <h2 id="goal-attention-drawer-title" className="typo-section-title text-foreground truncate">{dl.attention_title}</h2>
          <p className="typo-caption text-foreground truncate">{projectName} · {items.length}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}><X className="w-4 h-4" /></Button>
      </div>

      <ul className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
        {items.map((item, i) => {
          const meta = KIND_META[item.kind as KindKey] ?? KIND_META.overdue;
          const Icon = meta.icon;
          return (
            <li
              key={`${item.kind}-${item.goalId}-${item.stepId ?? i}`}
              style={{ boxShadow: `inset 3px 0 0 0 ${meta.edge}` }}
              className="flex items-center gap-3 rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 pl-4 pr-3 py-2.5 transition-[border-color] duration-200 hover:border-primary/25"
            >
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1 ${meta.chip}`}>
                <Icon className="w-3 h-3" /> {dl[meta.labelKey]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="typo-body text-foreground truncate">{item.goalTitle}</p>
                {item.detail && <p className="typo-caption text-foreground truncate">{item.detail}</p>}
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
    </BaseModal>
  );
}

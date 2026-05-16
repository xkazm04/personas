import { File, Tag, Target } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContextItem } from './contextMapTypes';

export default function ContextCard({
  ctx,
  selected,
  onSelect,
  goalCount = 0,
  firstGoalId,
}: {
  ctx: ContextItem;
  selected: boolean;
  onSelect: () => void;
  goalCount?: number;
  firstGoalId?: string;
}) {
  const { t } = useTranslation();
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingLifecycleSubTab = useSystemStore((s) => s.setPendingLifecycleSubTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  const handleGoalsJump = () => {
    if (firstGoalId) setPendingGoalSpotlightId(firstGoalId);
    setPendingLifecycleSubTab('goals');
    setDevToolsTab('lifecycle');
  };

  return (
    <div
      onClick={onSelect}
      className={`animate-fade-in border rounded-modal p-4 cursor-pointer transition-colors ${
        selected
          ? 'bg-primary/10 border-primary/20'
          : 'border-primary/10 hover:bg-primary/5 hover:border-primary/20'
      }`}
    >
      <h4 className="typo-card-label mb-1">{ctx.name}</h4>
      <p className="text-md text-foreground line-clamp-2 mb-3">{ctx.description}</p>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] text-foreground bg-primary/5 rounded-full px-2 py-0.5">
          <File className="w-3 h-3" />
          {ctx.filePaths.length} files
        </span>
        {ctx.keywords.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-foreground bg-primary/5 rounded-full px-2 py-0.5">
            <Tag className="w-3 h-3" />
            {ctx.keywords.length}
          </span>
        )}
        {goalCount > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleGoalsJump(); }}
            title={t.plugins.dev_tools.context_goal_coverage_tooltip}
            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:border-violet-500/50 transition-colors"
          >
            <Target className="w-3 h-3" />
            {goalCount} {goalCount === 1 ? t.plugins.dev_tools.context_goal_singular : t.plugins.dev_tools.context_goal_plural}
          </button>
        ) : (
          <span
            title={t.plugins.dev_tools.context_no_goal_tooltip}
            className="inline-flex items-center gap-1 text-[10px] text-foreground/40 border border-dashed border-foreground/15 rounded-full px-2 py-0.5"
          >
            <Target className="w-3 h-3" />
            {t.plugins.dev_tools.context_no_goal_label}
          </span>
        )}
      </div>
    </div>
  );
}

import { File, Tag, Target, Lightbulb, Sparkles, Gauge } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ContextItem } from './contextMapTypes';

export default function ContextCard({
  ctx,
  selected,
  onSelect,
  goalCount = 0,
  firstGoalId,
  ideaCount = 0,
  kpiCount = 0,
  onScan,
  scanning = false,
  scanDisabled = false,
}: {
  ctx: ContextItem;
  selected: boolean;
  onSelect: () => void;
  goalCount?: number;
  firstGoalId?: string;
  ideaCount?: number;
  kpiCount?: number;
  onScan?: () => void;
  scanning?: boolean;
  scanDisabled?: boolean;
}) {
  const { t, tx } = useTranslation();
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  const handleGoalsJump = () => {
    if (firstGoalId) setPendingGoalSpotlightId(firstGoalId);
    setDevToolsTab('goals');
  };

  const handleIdeasJump = () => {
    setDevToolsTab('idea-triage');
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
            className="inline-flex items-center gap-1 text-[10px] text-foreground border border-dashed border-foreground/15 rounded-full px-2 py-0.5"
          >
            <Target className="w-3 h-3" />
            {t.plugins.dev_tools.context_no_goal_label}
          </span>
        )}
        {ideaCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleIdeasJump(); }}
            title={t.plugins.dev_tools.context_idea_coverage_tooltip}
            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 transition-colors"
          >
            <Lightbulb className="w-3 h-3" />
            {ideaCount} {ideaCount === 1 ? t.plugins.dev_tools.context_idea_singular : t.plugins.dev_tools.context_idea_plural}
          </button>
        )}
        {kpiCount > 0 && (
          <span
            title={t.kpis.context_kpis_title}
            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-300"
          >
            <Gauge className="w-3 h-3" />
            {tx(t.kpis.kpi_count, { count: kpiCount })}
          </span>
        )}
        {onScan && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!scanDisabled) onScan(); }}
            disabled={scanDisabled}
            title={t.plugins.dev_tools.context_scan_ideas_tooltip}
            className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-full border border-primary/15 bg-primary/5 text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {scanning ? <LoadingSpinner size="xs" /> : <Sparkles className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

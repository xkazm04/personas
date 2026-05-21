import { useMemo } from 'react';
import { X, File, ArrowUpRight, Target, ListChecks } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContextItem } from './contextMapTypes';

export default function ContextDetail({ ctx, onClose }: { ctx: ContextItem; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const goals = useSystemStore((s) => s.goals);
  const tasks = useSystemStore((s) => s.tasks);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  // Goals scoped to this context + per-goal task summary (done / total).
  const linkedGoals = useMemo(() => {
    const matched = goals.filter((g) => g.context_id === ctx.id);
    return matched.map((g) => {
      const myTasks = tasks.filter((task) => task.goal_id === g.id);
      const done = myTasks.filter((task) => task.status === 'complete' || task.status === 'completed').length;
      return { goal: g, tasksTotal: myTasks.length, tasksDone: done };
    });
  }, [goals, tasks, ctx.id]);

  const handleGoalJump = (goalId: string) => {
    setPendingGoalSpotlightId(goalId);
    setDevToolsTab('goals');
  };

  return (
    <div
      className="animate-fade-slide-in w-80 flex-shrink-0 border-l border-primary/10 pl-5 overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="typo-section-title">{ctx.name}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <p className="text-md text-foreground mb-4">{ctx.description}</p>

      {/* Goals linked to this context (cycle 8 surfaced the count; here the items) */}
      <div className="mb-4">
        <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2 flex items-center gap-1.5">
          <Target className="w-3 h-3" />
          {t.plugins.dev_tools.context_detail_goals_heading} ({linkedGoals.length})
        </h4>
        {linkedGoals.length === 0 ? (
          <p className="typo-caption text-foreground/55 italic">{t.plugins.dev_tools.context_detail_no_goals}</p>
        ) : (
          <ul className="space-y-1.5">
            {linkedGoals.map(({ goal, tasksTotal, tasksDone }) => (
              <li key={goal.id}>
                <button
                  type="button"
                  onClick={() => handleGoalJump(goal.id)}
                  title={t.plugins.dev_tools.context_detail_goal_jump_tooltip}
                  className="w-full text-left rounded-modal border border-primary/10 bg-card/30 px-2.5 py-2 hover:border-primary/25 hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="typo-caption text-foreground font-medium truncate flex-1">{goal.title}</span>
                    <span className="typo-caption text-foreground/60 tabular-nums shrink-0">{goal.progress}%</span>
                  </div>
                  {tasksTotal > 0 && (
                    <p className="typo-caption text-foreground/60 mt-0.5 flex items-center gap-1">
                      <ListChecks className="w-2.5 h-2.5" />
                      {tx(t.plugins.dev_tools.context_detail_task_summary, { done: tasksDone, total: tasksTotal })}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4">
        <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2">
          {t.plugins.dev_tools.files} ({ctx.filePaths.length})
        </h4>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {ctx.filePaths.map((fp) => (
            <div key={fp} className="flex items-center gap-1.5 typo-caption text-foreground py-0.5">
              <File className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{fp}</span>
            </div>
          ))}
        </div>
      </div>

      {ctx.keywords.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2">{t.plugins.dev_tools.keywords}</h4>
          <div className="flex flex-wrap gap-1.5">
            {ctx.keywords.map((kw) => (
              <span key={kw} className="px-2 py-0.5 text-[10px] bg-primary/5 border border-primary/10 rounded-full text-foreground">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {ctx.entryPoints.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2">{t.plugins.dev_tools.entry_points}</h4>
          <div className="space-y-1">
            {ctx.entryPoints.map((ep) => (
              <div key={ep} className="flex items-center gap-1.5 typo-caption text-foreground py-0.5">
                <ArrowUpRight className="w-3 h-3 flex-shrink-0 text-amber-400/60" />
                <span className="truncate">{ep}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

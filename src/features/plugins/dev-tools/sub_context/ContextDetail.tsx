import { useMemo, useState, type FormEvent } from 'react';
import { X, File, ArrowUpRight, Target, ListChecks, Gauge, Plus } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { TRACK_COLOR } from '@/features/teams/sub_kpis/kpiMeta';
import type { ContextItem } from './contextMapTypes';

export default function ContextDetail({ ctx, onClose }: { ctx: ContextItem; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const goals = useSystemStore((s) => s.goals);
  const tasks = useSystemStore((s) => s.tasks);
  const kpis = useSystemStore((s) => s.kpis);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const createKpi = useSystemStore((s) => s.createKpi);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  // KPIs scoped to this context (Part 3 context-level KPIs).
  const linkedKpis = useMemo(
    () => kpis.filter((k) => k.context_id === ctx.id && k.status !== 'archived'),
    [kpis, ctx.id],
  );
  const [adding, setAdding] = useState(false);
  const [kpiName, setKpiName] = useState('');
  const [kpiTarget, setKpiTarget] = useState('');
  const [kpiUnit, setKpiUnit] = useState('');

  const handleCreateKpi = async (e: FormEvent) => {
    e.preventDefault();
    if (!kpiName.trim() || !activeProjectId) return;
    // '__ungrouped__' is a UI sentinel, not a real group id — drop it so the FK
    // stays valid (the KPI is still scoped to the context via context_id).
    const groupId = ctx.groupId && ctx.groupId !== '__ungrouped__' ? ctx.groupId : undefined;
    try {
      await createKpi({
        projectId: activeProjectId,
        name: kpiName.trim(),
        contextId: ctx.id,
        contextGroupId: groupId,
        category: 'technical',
        measureKind: 'manual',
        unit: kpiUnit.trim() || undefined,
        targetValue: kpiTarget ? Number(kpiTarget) : undefined,
        status: 'active',
      });
      setKpiName('');
      setKpiTarget('');
      setKpiUnit('');
      setAdding(false);
    } catch (err) {
      toastCatch('ContextDetail:createKpi', t.kpis.create_kpi_failed)(err);
    }
  };

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
          <p className="typo-caption text-foreground italic">{t.plugins.dev_tools.context_detail_no_goals}</p>
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
                    <span className="typo-caption text-foreground tabular-nums shrink-0">{goal.progress}%</span>
                  </div>
                  {tasksTotal > 0 && (
                    <p className="typo-caption text-foreground mt-0.5 flex items-center gap-1">
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

      {/* KPIs scoped to this context (Part 3 context-level KPIs) */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium flex items-center gap-1.5">
            <Gauge className="w-3 h-3" />
            {t.kpis.context_kpis_title} ({linkedKpis.length})
          </h4>
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="typo-caption text-primary hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            {t.kpis.add_kpi_for_context}
          </button>
        </div>

        {adding && (
          <form onSubmit={handleCreateKpi} className="mb-2 rounded-modal border border-primary/10 bg-card/30 p-2 space-y-2">
            <input
              value={kpiName}
              onChange={(e) => setKpiName(e.target.value)}
              placeholder={t.kpis.create_kpi_name_ph}
              autoFocus
              className="w-full px-2 py-1 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-ring"
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={kpiTarget}
                onChange={(e) => setKpiTarget(e.target.value)}
                placeholder={t.kpis.create_kpi_target_ph}
                className="w-20 px-2 py-1 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-ring tabular-nums"
              />
              <input
                value={kpiUnit}
                onChange={(e) => setKpiUnit(e.target.value)}
                placeholder={t.kpis.create_kpi_unit_ph}
                className="w-16 px-2 py-1 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-ring"
              />
              <Button type="submit" variant="accent" accentColor="amber" size="sm" disabled={!kpiName.trim()}>
                {t.kpis.create_kpi_submit}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                {t.kpis.create_kpi_cancel}
              </Button>
            </div>
          </form>
        )}

        {linkedKpis.length === 0 && !adding ? (
          <p className="typo-caption text-foreground italic">{t.kpis.context_no_kpis}</p>
        ) : (
          <ul className="space-y-1.5">
            {linkedKpis.map((k) => (
              <li
                key={k.id}
                className="rounded-modal border border-primary/10 bg-card/30 px-2.5 py-1.5 flex items-center gap-2"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: TRACK_COLOR[kpiTrack(k)] }}
                />
                <span className="typo-caption text-foreground font-medium truncate flex-1">{k.name}</span>
                <span className="typo-caption text-foreground tabular-nums shrink-0">
                  {k.current_value ?? '—'} / {k.target_value ?? '—'} {k.unit}
                </span>
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

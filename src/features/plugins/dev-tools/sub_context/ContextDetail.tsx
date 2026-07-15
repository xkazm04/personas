import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { X, File, ArrowUpRight, Target, ListChecks, Gauge, Plus, Pin, PinOff, Layers } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from '@/stores/systemStore';
import { openGoalsBoard } from '@/features/plugins/companion/guidance/appActions';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { TRACK_COLOR } from '@/features/teams/sub_kpis/kpiMeta';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import type { ContextItem } from './contextMapTypes';

export default function ContextDetail({
  ctx,
  onClose,
  useCases = [],
}: {
  ctx: ContextItem;
  onClose: () => void;
  /** Non-archived use cases whose slice includes this context. */
  useCases?: DevUseCase[];
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const goals = useSystemStore((s) => s.goals);
  const tasks = useSystemStore((s) => s.tasks);
  const kpis = useSystemStore((s) => s.kpis);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const createKpi = useSystemStore((s) => s.createKpi);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);
  const setContextPinned = useSystemStore((s) => s.setContextPinned);

  const handleTogglePin = () => {
    void setContextPinned(ctx.id, !ctx.pinned).catch(
      toastCatch('ContextDetail:setPinned', t.plugins.dev_tools.context_detail_pin_failed),
    );
  };

  // KPIs scoped to this context (Part 3 context-level KPIs).
  const linkedKpis = useMemo(
    () => kpis.filter((k) => k.context_id === ctx.id && k.status !== 'archived'),
    [kpis, ctx.id],
  );
  const [adding, setAdding] = useState(false);
  const [kpiName, setKpiName] = useState('');
  const [kpiTarget, setKpiTarget] = useState('');
  const [kpiUnit, setKpiUnit] = useState('');
  // Scope of the KPI being authored: this context, or one of the use cases that
  // slice through it (the narrower, more honest owner of a behavioral outcome).
  const [kpiScopeUseCaseId, setKpiScopeUseCaseId] = useState<string | null>(null);

  const activeUseCases = useMemo(() => useCases.filter((u) => u.status === 'active'), [useCases]);

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
        // A use-case-scoped KPI still records this context as its anchor, so the
        // Factory matrix can place it; `useCaseId` is what the derivation reads.
        contextId: ctx.id,
        contextGroupId: groupId,
        useCaseId: kpiScopeUseCaseId ?? undefined,
        category: 'technical',
        measureKind: 'manual',
        unit: kpiUnit.trim() || undefined,
        targetValue: kpiTarget ? Number(kpiTarget) : undefined,
        status: 'active',
      });
      setKpiName('');
      setKpiTarget('');
      setKpiUnit('');
      setKpiScopeUseCaseId(null);
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
    openGoalsBoard();
  };

  return (
    // `sticky top-0 self-start` is what keeps the panel's head in view. The page
    // body (ContentLayout's ContentBody) is the scroll container, so a plain
    // flex sibling scrolls away with the board — click a context near the bottom
    // of a 260-row map and the panel's header ends up far above the fold. Pinned
    // to the top of that scroller, the header is always where the user is
    // looking, and the panel scrolls its own overflow instead of the page's.
    <motion.aside
      key="context-detail"
      initial={reduced ? false : { opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 20 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
      className="w-80 flex-shrink-0 self-start sticky top-0 max-h-[calc(100dvh-12rem)] flex flex-col border-l border-primary/10 pl-5"
      aria-label={ctx.name}
    >
      {/* Header — outside the scroll area, so it never leaves. */}
      <div className="flex items-center justify-between pb-3 shrink-0">
        <h3 className="typo-section-title flex items-center gap-1.5 min-w-0">
          {ctx.pinned && <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400/30 shrink-0" />}
          <span className="truncate">{ctx.name}</span>
        </h3>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleTogglePin}
            aria-pressed={ctx.pinned}
            aria-label={ctx.pinned ? t.plugins.dev_tools.context_detail_unpin : t.plugins.dev_tools.context_detail_pin}
            title={t.plugins.dev_tools.context_detail_pin_tooltip}
          >
            {ctx.pinned ? (
              <PinOff className="w-3.5 h-3.5" />
            ) : (
              <Pin className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Body — the only thing that scrolls. Keyed on the context id so
          switching selection cross-fades the contents instead of snapping. */}
      <motion.div
        key={ctx.id}
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
        className="flex-1 min-h-0 overflow-y-auto pr-1"
      >
      <p className="text-md text-foreground mb-4">{ctx.description}</p>

      {/* Use cases slicing through this context — the behavioral layer above the
          code-ownership partition. A context with none is code nobody has named
          an outcome for yet. */}
      <div className="mb-4">
        <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2 flex items-center gap-1.5">
          <Layers className="w-3 h-3" />
          {t.plugins.dev_tools.uc_title} ({useCases.length})
        </h4>
        {useCases.length === 0 ? (
          <p className="typo-caption text-foreground italic">{t.plugins.dev_tools.uc_context_none}</p>
        ) : (
          <ul className="space-y-1.5">
            {useCases.map((uc) => (
              <li
                key={uc.id}
                className="rounded-modal border border-primary/10 bg-card/30 px-2.5 py-1.5 flex items-center gap-2"
              >
                <span className="typo-caption text-foreground font-medium truncate flex-1">{uc.name}</span>
                {uc.status === 'proposed' && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 shrink-0">
                    {t.plugins.dev_tools.uc_status_proposed}
                  </span>
                )}
                <span className="typo-caption text-foreground tabular-nums shrink-0">
                  {tx(t.plugins.dev_tools.uc_span_count, { count: uc.context_ids.length })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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

            {/* Scope. An outcome that spans contexts belongs to a use case, not
                to whichever context you happened to have open. */}
            {activeUseCases.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-primary font-medium mb-1">
                  {t.kpis.kpi_scope_label}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setKpiScopeUseCaseId(null)}
                    aria-pressed={kpiScopeUseCaseId === null}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      kpiScopeUseCaseId === null
                        ? 'border-primary/50 bg-primary/15 text-foreground'
                        : 'border-primary/10 bg-card/30 text-foreground hover:border-primary/30'
                    }`}
                  >
                    {t.kpis.kpi_scope_this_context}
                  </button>
                  {activeUseCases.map((uc) => (
                    <button
                      key={uc.id}
                      type="button"
                      onClick={() => setKpiScopeUseCaseId(uc.id)}
                      aria-pressed={kpiScopeUseCaseId === uc.id}
                      title={tx(t.plugins.dev_tools.uc_span_count, { count: uc.context_ids.length })}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        kpiScopeUseCaseId === uc.id
                          ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                          : 'border-primary/10 bg-card/30 text-foreground hover:border-primary/30'
                      }`}
                    >
                      {uc.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
      </motion.div>
    </motion.aside>
  );
}

/**
 * Goal-to-Plan — read-only narrated planner (Stage 1).
 *
 * The user states an outcome in plain language; the panel maps it to a
 * reviewable sequence of in-app action steps drawn from the automation tool
 * catalog and renders them as cards. Nothing executes — this is the preview
 * that earns trust before any future "watch the app build it" stage.
 */
import { useState, useCallback, useEffect } from 'react';
import { Sparkles, ShieldCheck, ListChecks, Eraser, Play, Pause, Square, CheckCircle2, History } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from '@/stores/systemStore';
import Button from '@/features/shared/components/buttons/Button';
import { Bot } from 'lucide-react';
import { generatePlan } from './planProvider';
import { PlanStepCard } from './PlanStepCard';
import { IntentSignalChips } from './IntentSignalChips';
import { usePlannerStore } from './plannerStore';
import type { Plan, PlanStep } from './types';

export function GoalPlannerPanel() {
  const { t, tx } = useTranslation();
  const { shouldAnimate } = useMotion();
  // Restore the last goal on mount, or a one-shot prefill handed in from
  // another surface (the build composer's "Plan this first"). Runs once.
  const [goal, setGoal] = useState(() => {
    const s = usePlannerStore.getState();
    return s.consumePrefill() ?? s.lastGoal;
  });
  const recentGoals = usePlannerStore((s) => s.recentGoals);
  const rememberGoal = usePlannerStore((s) => s.rememberGoal);
  const clearRecent = usePlannerStore((s) => s.clearRecent);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [planning, setPlanning] = useState(false);
  // Watch player: index of the step currently highlighted, or null when idle.
  const [watchIndex, setWatchIndex] = useState<number | null>(null);
  const [watchPaused, setWatchPaused] = useState(false);

  const handlePreview = useCallback(async () => {
    // Resolve through the provider seam: the LLM brain when available, the
    // deterministic rule planner otherwise. Async so the LLM swap is free.
    setPlanning(true);
    setWatchIndex(null);
    try {
      const next = await generatePlan(goal);
      setPlan(next);
      setSteps(next?.steps ?? []);
      if (next) rememberGoal(goal);
    } finally {
      setPlanning(false);
    }
  }, [goal, rememberGoal]);

  const handleClear = useCallback(() => {
    setGoal('');
    setPlan(null);
    setSteps([]);
    setWatchIndex(null);
  }, []);

  // Editing only shapes the local preview — the suggested plan stays intact
  // so "reset" can restore it. Nothing here touches the backend.
  // Editing stops the walkthrough so the highlighted index can't drift.
  const removeStep = useCallback((id: string) => {
    setWatchIndex(null);
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const moveStep = useCallback((id: string, dir: -1 | 1) => {
    setWatchIndex(null);
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }, []);
  const resetPlan = useCallback(() => {
    setWatchIndex(null);
    if (plan) setSteps(plan.steps);
  }, [plan]);

  // Graduate from preview to the real build flow: prefill the composer with
  // the goal (autoLaunch=false, so the user still confirms by launching) and
  // navigate there. agentTab must leave 'planner' or PersonasPage keeps this
  // pane mounted.
  const startBuildFromPlan = useCallback(() => {
    if (!plan) return;
    const sys = useSystemStore.getState();
    sys.setCompanionPrefill({ intent: plan.goal, name: null, autoLaunch: false });
    sys.setAgentTab('all');
    sys.setIsCreatingPersona(true);
    sys.setSidebarSection('personas');
  }, [plan]);

  // Watch player — auto-advances through the steps, highlighting each in turn.
  // Pure UI: navigates nothing, writes nothing. Stops at the end.
  const startWatch = useCallback(() => {
    if (steps.length > 0) { setWatchPaused(false); setWatchIndex(0); }
  }, [steps.length]);
  const stopWatch = useCallback(() => { setWatchIndex(null); setWatchPaused(false); }, []);

  useEffect(() => {
    if (watchIndex === null || watchIndex >= steps.length || watchPaused) return;
    const ms = shouldAnimate ? 1600 : 900;
    const id = setTimeout(() => {
      setWatchIndex((i) => (i === null ? null : i + 1));
    }, ms);
    return () => clearTimeout(id);
  }, [watchIndex, steps.length, shouldAnimate, watchPaused]);

  // Keyboard control while watching: Space = play/pause, ←/→ = step, Esc = stop.
  // Ignored when focus is in a text field so typing a goal isn't hijacked.
  useEffect(() => {
    if (watchIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        setWatchPaused((p) => !p);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setWatchPaused(true);
        setWatchIndex((i) => (i === null ? null : Math.min(i + 1, steps.length)));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setWatchPaused(true);
        setWatchIndex((i) => (i === null ? null : Math.max(i - 1, 0)));
      } else if (e.key === 'Escape') {
        stopWatch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [watchIndex, steps.length, stopWatch]);

  const canPreview = goal.trim().length > 0;
  const stepCount = steps.length;
  const isEdited = plan != null && (
    steps.length !== plan.steps.length || steps.some((s, i) => plan.steps[i]?.id !== s.id)
  );
  const isWatching = watchIndex !== null;
  const watchDone = isWatching && watchIndex! >= steps.length;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-5 overflow-y-auto px-6 py-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-300" />
          <h1 className="typo-title text-foreground">{t.planner.page_title}</h1>
        </div>
        <p className="mt-1 typo-body text-foreground">{t.planner.page_subtitle}</p>
      </div>

      {/* Goal input */}
      <div className="flex flex-col gap-3 rounded-card bg-secondary/30 p-4 ring-1 ring-primary/10">
        <textarea
          data-testid="planner-goal-input"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canPreview && !planning) void handlePreview();
          }}
          placeholder={t.planner.goal_placeholder}
          rows={3}
          className="w-full resize-none rounded-input bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/40 outline-none ring-1 ring-primary/10 focus:ring-primary/30"
        />
        {/* Live inference strip — narrates detected signals as you type, before Preview */}
        <IntentSignalChips text={goal} />
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<ListChecks className="h-4 w-4" />}
            onClick={handlePreview}
            disabled={!canPreview || planning}
            loading={planning}
            loadingLabel={t.common.loading}
            disabledReason={t.planner.preview_disabled_reason}
            data-testid="planner-preview-button"
          >
            {t.planner.preview_button}
          </Button>
          {(plan || goal) && (
            <Button variant="ghost" size="sm" icon={<Eraser className="h-4 w-4" />} onClick={handleClear}>
              {t.planner.clear}
            </Button>
          )}
        </div>
      </div>

      {/* Recent goals — click to refill. Goal text is user content, untranslated. */}
      {recentGoals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-foreground" />
          {recentGoals.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGoal(g)}
              title={g}
              className="max-w-[16rem] truncate rounded-full bg-secondary/40 px-2.5 py-1 typo-label text-foreground hover:bg-secondary/70"
            >
              {g}
            </button>
          ))}
          <button
            type="button"
            onClick={clearRecent}
            className="rounded-full px-2 py-1 typo-label text-foreground hover:bg-secondary/50"
          >
            {t.common.clear}
          </button>
        </div>
      )}

      {/* Read-only banner */}
      <div className="flex items-start gap-2.5 rounded-card bg-emerald-500/5 p-3 ring-1 ring-emerald-500/20">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <div className="min-w-0">
          <span className="typo-heading text-emerald-200">{t.planner.readonly_badge}</span>
          <p className="typo-body text-foreground">{t.planner.readonly_note}</p>
        </div>
      </div>

      {/* Plan / empty state */}
      {plan ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="typo-label text-foreground">{t.planner.steps_heading}</span>
              {isEdited && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 typo-label text-amber-300">{t.planner.edited_badge}</span>
              )}
            </span>
            <span className="flex items-center gap-2">
              {isEdited && !isWatching && (
                <Button variant="link" size="xs" onClick={resetPlan}>{t.planner.reset_plan}</Button>
              )}
              {!isWatching && (
                <Button variant="primary" size="xs" icon={<Bot className="h-3.5 w-3.5" />} onClick={startBuildFromPlan} data-testid="planner-start-build">
                  {t.planner.actions.create_persona_title}
                </Button>
              )}
              {!isWatching ? (
                <Button variant="accent" accentColor="violet" size="xs" icon={<Play className="h-3.5 w-3.5" />} onClick={startWatch} data-testid="planner-watch-button">
                  {t.planner.watch_button}
                </Button>
              ) : (
                <Button variant="accent" accentColor="rose" size="xs" icon={<Square className="h-3.5 w-3.5" />} onClick={stopWatch}>
                  {t.planner.watch_stop}
                </Button>
              )}
              <span className="typo-label text-foreground">
                {tx(stepCount === 1 ? t.planner.step_count_one : t.planner.step_count_other, { count: String(stepCount) })}
                {' · '}
                {plan.source === 'llm' ? t.planner.source_llm : t.planner.source_rule}
              </span>
            </span>
          </div>

          {/* Watch player status */}
          {isWatching && (
            <div className="flex items-center gap-2.5 rounded-card bg-primary/5 px-3 py-2 ring-1 ring-primary/20">
              {watchDone ? (
                <>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                  <span className="typo-heading text-foreground">{t.planner.watch_done}</span>
                </>
              ) : watchPaused ? (
                <>
                  <Pause className="h-4 w-4 shrink-0 text-violet-300" />
                  <span className="typo-heading text-foreground">
                    {tx(t.planner.watch_step_of, { current: String(Math.min(watchIndex! + 1, stepCount)), total: String(stepCount) })}
                  </span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 shrink-0 animate-pulse text-violet-300" />
                  <span className="typo-heading text-foreground">
                    {tx(t.planner.watch_step_of, { current: String(Math.min(watchIndex! + 1, stepCount)), total: String(stepCount) })}
                  </span>
                </>
              )}
            </div>
          )}

          {steps.map((step, i) => (
            <PlanStepCard
              key={step.id}
              step={step}
              index={i}
              isFirst={i === 0}
              isLast={i === steps.length - 1}
              active={isWatching && !watchDone && i === watchIndex}
              onRemove={removeStep}
              onMoveUp={(id) => moveStep(id, -1)}
              onMoveDown={(id) => moveStep(id, 1)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-primary/15 px-6 py-10 text-center">
          <ListChecks className="h-6 w-6 text-foreground" />
          <span className="typo-heading text-foreground">{t.planner.empty_title}</span>
          <span className="typo-body text-foreground">{t.planner.empty_hint}</span>
          {/* Starter-goal gallery — click to prefill the box and beat the blank page */}
          <div className="mt-2 flex w-full flex-col gap-2">
            <span className="typo-label text-foreground">{t.planner.examples_heading}</span>
            {[t.planner.example_1, t.planner.example_2, t.planner.example_3].map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setGoal(ex)}
                className="rounded-input bg-secondary/40 px-3 py-2 text-left typo-body text-foreground ring-1 ring-primary/10 hover:bg-secondary/70 hover:ring-primary/30"
                data-testid="planner-example-goal"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default GoalPlannerPanel;

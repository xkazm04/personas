/**
 * Goal-to-Plan — read-only narrated planner (Stage 1).
 *
 * The user states an outcome in plain language; the panel maps it to a
 * reviewable sequence of in-app action steps drawn from the automation tool
 * catalog and renders them as cards. Nothing executes — this is the preview
 * that earns trust before any future "watch the app build it" stage.
 */
import { useState, useCallback } from 'react';
import { Sparkles, ShieldCheck, ListChecks, Eraser } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { generatePlan } from './planProvider';
import { PlanStepCard } from './PlanStepCard';
import type { Plan, PlanStep } from './types';

export function GoalPlannerPanel() {
  const { t, tx } = useTranslation();
  const [goal, setGoal] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [planning, setPlanning] = useState(false);

  const handlePreview = useCallback(async () => {
    // Resolve through the provider seam: the LLM brain when available, the
    // deterministic rule planner otherwise. Async so the LLM swap is free.
    setPlanning(true);
    try {
      const next = await generatePlan(goal);
      setPlan(next);
      setSteps(next?.steps ?? []);
    } finally {
      setPlanning(false);
    }
  }, [goal]);

  const handleClear = useCallback(() => {
    setGoal('');
    setPlan(null);
    setSteps([]);
  }, []);

  // Editing only shapes the local preview — the suggested plan stays intact
  // so "reset" can restore it. Nothing here touches the backend.
  const removeStep = useCallback((id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const moveStep = useCallback((id: string, dir: -1 | 1) => {
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
    if (plan) setSteps(plan.steps);
  }, [plan]);

  const canPreview = goal.trim().length > 0;
  const stepCount = steps.length;
  const isEdited = plan != null && (
    steps.length !== plan.steps.length || steps.some((s, i) => plan.steps[i]?.id !== s.id)
  );

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
              {isEdited && (
                <Button variant="link" size="xs" onClick={resetPlan}>{t.planner.reset_plan}</Button>
              )}
              <span className="typo-label text-foreground">
                {tx(stepCount === 1 ? t.planner.step_count_one : t.planner.step_count_other, { count: String(stepCount) })}
                {' · '}
                {plan.source === 'llm' ? t.planner.source_llm : t.planner.source_rule}
              </span>
            </span>
          </div>
          {steps.map((step, i) => (
            <PlanStepCard
              key={step.id}
              step={step}
              index={i}
              isFirst={i === 0}
              isLast={i === steps.length - 1}
              onRemove={removeStep}
              onMoveUp={(id) => moveStep(id, -1)}
              onMoveDown={(id) => moveStep(id, 1)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-primary/15 px-6 py-10 text-center">
          <ListChecks className="h-6 w-6 text-foreground" />
          <span className="typo-heading text-foreground">{t.planner.empty_title}</span>
          <span className="typo-body text-foreground">{t.planner.empty_hint}</span>
        </div>
      )}
    </div>
  );
}

export default GoalPlannerPanel;

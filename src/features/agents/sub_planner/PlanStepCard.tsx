/**
 * Goal-to-Plan — one reviewable, editable step.
 *
 * Renders a single PlanStep as a numbered card: category-colored icon, the
 * translated title/detail/rationale (resolved from the step's action +
 * params), a confidence bar, and inline controls to remove or reorder the
 * step. Still no execution — editing only shapes the preview before any
 * future confirm stage.
 */
import {
  Sparkles, Bot, Plug, Zap, Clock, Globe, GitCompare, Send, ShieldCheck,
  Trash2, ChevronUp, ChevronDown, CornerDownRight,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ACTION_CATALOG, CATEGORY_STYLE } from './actionCatalog';
import { confidenceLevel, type PlanStep } from './types';

const ICONS: Record<string, LucideIcon> = {
  Sparkles, Bot, Plug, Zap, Clock, Globe, GitCompare, Send, ShieldCheck,
};

interface StepText { title: string; detail: string; rationale: string }

/** Resolve the translated {title, detail, rationale} for a step. Keeping the
 *  action → template mapping explicit (rather than a dynamic `t` path lookup)
 *  keeps it type-safe against the generated Translations tree. */
function useStepText(step: PlanStep): StepText {
  const { t, tx } = useTranslation();
  const a = t.planner.actions;
  const p = step.params ?? {};
  switch (step.actionId) {
    case 'understand_goal':
      return { title: a.understand_goal_title, detail: tx(a.understand_goal_detail, p), rationale: a.understand_goal_rationale };
    case 'create_persona':
      return { title: a.create_persona_title, detail: tx(a.create_persona_detail, p), rationale: a.create_persona_rationale };
    case 'connect_service':
      return { title: tx(a.connect_service_title, p), detail: tx(a.connect_service_detail, p), rationale: a.connect_service_rationale };
    case 'configure_trigger':
      return { title: a.configure_trigger_title, detail: tx(a.configure_trigger_detail, p), rationale: a.configure_trigger_rationale };
    case 'configure_schedule':
      return { title: a.configure_schedule_title, detail: tx(a.configure_schedule_detail, p), rationale: a.configure_schedule_rationale };
    case 'fetch_web':
      return { title: a.fetch_web_title, detail: a.fetch_web_detail, rationale: a.fetch_web_rationale };
    case 'detect_changes':
      return { title: a.detect_changes_title, detail: a.detect_changes_detail, rationale: a.detect_changes_rationale };
    case 'send_notification':
      return { title: tx(a.send_notification_title, p), detail: tx(a.send_notification_detail, p), rationale: a.send_notification_rationale };
    case 'review_confirm':
      return { title: a.review_confirm_title, detail: a.review_confirm_detail, rationale: a.review_confirm_rationale };
    default:
      return { title: '', detail: '', rationale: '' };
  }
}

/** Three-segment confidence bar — filled count maps to the coarse level. */
function ConfidenceBar({ score, label }: { score: number; label: string }) {
  const level = confidenceLevel(score);
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  const color = level === 'high' ? 'bg-emerald-400' : level === 'medium' ? 'bg-amber-400' : 'bg-foreground/30';
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1 w-3 rounded-full ${i < filled ? color : 'bg-foreground/15'}`} />
        ))}
      </span>
      <span className="typo-label text-foreground">{label}</span>
    </span>
  );
}

/** Categories that map to a concrete app destination the step would open. */
const DESTINATION_CATEGORIES = new Set(['persona', 'connector', 'trigger', 'schedule', 'action']);

export interface PlanStepCardProps {
  step: PlanStep;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  /** True while the watch player is highlighting this step. */
  active?: boolean;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

export function PlanStepCard({ step, index, isFirst, isLast, active = false, onRemove, onMoveUp, onMoveDown }: PlanStepCardProps) {
  const { t, tx } = useTranslation();
  const action = ACTION_CATALOG[step.actionId];
  const style = CATEGORY_STYLE[action.category];
  const Icon = ICONS[action.icon] ?? Sparkles;
  const { title, detail, rationale } = useStepText(step);

  const level = confidenceLevel(step.confidence);
  const confidenceLabel =
    level === 'high' ? t.planner.confidence_high
      : level === 'medium' ? t.planner.confidence_medium
        : t.planner.confidence_low;

  const categoryLabel =
    action.category === 'persona' ? t.planner.category_persona
      : action.category === 'connector' ? t.planner.category_connector
        : action.category === 'trigger' ? t.planner.category_trigger
          : action.category === 'schedule' ? t.planner.category_schedule
            : action.category === 'review' ? t.planner.category_review
              : action.category === 'action' ? t.planner.category_action
                : t.planner.category_navigation;

  const hasDestination = DESTINATION_CATEGORIES.has(action.category);

  return (
    <div
      className={`group flex gap-3 rounded-card p-3 transition-all ${
        active
          ? 'bg-primary/10 ring-2 ring-primary/50 shadow-elevation-2'
          : `bg-secondary/30 ring-1 ${style.ring}`
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/70 typo-label text-foreground">
        {index + 1}
      </span>

      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-interactive bg-secondary/50 ${style.icon}`}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="typo-heading text-foreground">{title}</span>
          <span className={`rounded-full px-2 py-0.5 typo-label ${style.chip}`}>{categoryLabel}</span>
          <span className="ml-auto"><ConfidenceBar score={step.confidence} label={confidenceLabel} /></span>
        </div>
        <p className="mt-1 typo-body text-foreground">{detail}</p>
        <p className="mt-0.5 typo-label italic text-foreground">{rationale}</p>
        {hasDestination && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-secondary/50 px-2 py-0.5 typo-label text-foreground">
            <CornerDownRight className="h-3 w-3" />
            {tx(t.planner.opens_in, { location: categoryLabel })}
          </span>
        )}
      </div>

      {/* Inline edit controls — reveal on hover/focus, keyboard reachable */}
      <div className="flex flex-col items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onMoveUp(step.id)}
          disabled={isFirst}
          aria-label={t.planner.step_move_up}
          title={t.planner.step_move_up}
          className="rounded-interactive p-1 text-foreground hover:bg-secondary/60 disabled:opacity-30"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(step.id)}
          disabled={isLast}
          aria-label={t.planner.step_move_down}
          title={t.planner.step_move_down}
          className="rounded-interactive p-1 text-foreground hover:bg-secondary/60 disabled:opacity-30"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(step.id)}
          aria-label={t.planner.step_remove}
          title={t.planner.step_remove}
          className="rounded-interactive p-1 text-rose-300 hover:bg-rose-500/15"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

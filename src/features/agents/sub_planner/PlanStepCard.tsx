/**
 * Goal-to-Plan — one reviewable step.
 *
 * Renders a single PlanStep as a numbered card: category-colored icon, the
 * translated title/detail (resolved from the step's action + params), and a
 * confidence chip. Pure presentation — no execution, no side effects.
 */
import {
  Sparkles, Bot, Plug, Zap, Clock, Globe, GitCompare, Send, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ACTION_CATALOG, CATEGORY_STYLE } from './actionCatalog';
import { confidenceLevel, type PlanStep } from './types';

const ICONS: Record<string, LucideIcon> = {
  Sparkles, Bot, Plug, Zap, Clock, Globe, GitCompare, Send, ShieldCheck,
};

/** Resolve the translated {title, detail} for a step. Keeping the action →
 *  template mapping explicit (rather than a dynamic `t` path lookup) keeps
 *  it type-safe against the generated Translations tree. */
function useStepText(step: PlanStep): { title: string; detail: string } {
  const { t, tx } = useTranslation();
  const a = t.planner.actions;
  const p = step.params ?? {};
  switch (step.actionId) {
    case 'understand_goal':
      return { title: a.understand_goal_title, detail: tx(a.understand_goal_detail, p) };
    case 'create_persona':
      return { title: a.create_persona_title, detail: tx(a.create_persona_detail, p) };
    case 'connect_service':
      return { title: tx(a.connect_service_title, p), detail: tx(a.connect_service_detail, p) };
    case 'configure_trigger':
      return { title: a.configure_trigger_title, detail: tx(a.configure_trigger_detail, p) };
    case 'configure_schedule':
      return { title: a.configure_schedule_title, detail: tx(a.configure_schedule_detail, p) };
    case 'fetch_web':
      return { title: a.fetch_web_title, detail: a.fetch_web_detail };
    case 'detect_changes':
      return { title: a.detect_changes_title, detail: a.detect_changes_detail };
    case 'send_notification':
      return { title: tx(a.send_notification_title, p), detail: tx(a.send_notification_detail, p) };
    case 'review_confirm':
      return { title: a.review_confirm_title, detail: a.review_confirm_detail };
    default:
      return { title: '', detail: '' };
  }
}

export function PlanStepCard({ step, index }: { step: PlanStep; index: number }) {
  const { t } = useTranslation();
  const action = ACTION_CATALOG[step.actionId];
  const style = CATEGORY_STYLE[action.category];
  const Icon = ICONS[action.icon] ?? Sparkles;
  const { title, detail } = useStepText(step);

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

  return (
    <div className={`flex gap-3 rounded-card bg-secondary/30 ring-1 ${style.ring} p-3`}>
      {/* Step number + connector rail */}
      <div className="flex flex-col items-center">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/70 typo-label text-foreground">
          {index + 1}
        </span>
      </div>

      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-interactive bg-secondary/50 ${style.icon}`}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="typo-heading text-foreground">{title}</span>
          <span className={`rounded-full px-2 py-0.5 typo-label ${style.chip}`}>{categoryLabel}</span>
          <span className="ml-auto typo-label text-foreground" title={confidenceLabel}>
            {confidenceLabel}
          </span>
        </div>
        <p className="mt-1 typo-body text-foreground">{detail}</p>
      </div>
    </div>
  );
}

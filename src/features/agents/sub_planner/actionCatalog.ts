/**
 * Goal-to-Plan — action catalog.
 *
 * The user-meaningful subset of the automation tool catalog (see
 * `src/test/automation/bridge.ts`). This is the *vocabulary* the planner
 * composes plans from. Each entry pins the underlying bridge primitive it
 * would drive at execution time — recorded for traceability, never invoked
 * in the read-only preview.
 */
import type { PlanAction, PlanActionId } from './types';

export const ACTION_CATALOG: Record<PlanActionId, PlanAction> = {
  understand_goal: {
    id: 'understand_goal',
    category: 'navigation',
    icon: 'Sparkles',
    bridgeRef: null,
  },
  create_persona: {
    id: 'create_persona',
    category: 'persona',
    icon: 'Bot',
    bridgeRef: 'startBuildFromIntent',
  },
  connect_service: {
    id: 'connect_service',
    category: 'connector',
    icon: 'Plug',
    bridgeRef: 'invokeCommand:create_credential',
  },
  configure_trigger: {
    id: 'configure_trigger',
    category: 'trigger',
    icon: 'Zap',
    bridgeRef: 'invokeCommand:create_trigger',
  },
  configure_schedule: {
    id: 'configure_schedule',
    category: 'schedule',
    icon: 'Clock',
    bridgeRef: 'invokeCommand:create_schedule',
  },
  fetch_web: {
    id: 'fetch_web',
    category: 'action',
    icon: 'Globe',
    bridgeRef: 'executePersona',
  },
  detect_changes: {
    id: 'detect_changes',
    category: 'action',
    icon: 'GitCompare',
    bridgeRef: 'executePersona',
  },
  send_notification: {
    id: 'send_notification',
    category: 'connector',
    icon: 'Send',
    bridgeRef: 'invokeCommand:create_credential',
  },
  review_confirm: {
    id: 'review_confirm',
    category: 'review',
    icon: 'ShieldCheck',
    bridgeRef: null,
  },
};

/** Tailwind token classes per category — mirrors the sidebar activity-dot
 *  palette so the planner reads as part of the same system. */
export const CATEGORY_STYLE: Record<
  PlanAction['category'],
  { icon: string; chip: string; ring: string }
> = {
  persona: { icon: 'text-violet-300', chip: 'bg-violet-500/10 text-violet-300', ring: 'ring-violet-500/20' },
  connector: { icon: 'text-blue-300', chip: 'bg-blue-500/10 text-blue-300', ring: 'ring-blue-500/20' },
  trigger: { icon: 'text-amber-300', chip: 'bg-amber-500/10 text-amber-300', ring: 'ring-amber-500/20' },
  schedule: { icon: 'text-emerald-300', chip: 'bg-emerald-500/10 text-emerald-300', ring: 'ring-emerald-500/20' },
  navigation: { icon: 'text-foreground/70', chip: 'bg-secondary/50 text-foreground/80', ring: 'ring-primary/15' },
  action: { icon: 'text-cyan-300', chip: 'bg-cyan-500/10 text-cyan-300', ring: 'ring-cyan-500/20' },
  review: { icon: 'text-foreground/80', chip: 'bg-secondary/60 text-foreground/90', ring: 'ring-primary/20' },
};

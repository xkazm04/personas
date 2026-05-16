/**
 * Cockpit widget registry — mirrors the dashboard registry pattern.
 *
 * Athena composes the cockpit via `compose_cockpit` ops emitting a list of
 * widgets. Each widget has a `kind` matching one of the keys here, plus a
 * `config` object the widget interprets.
 *
 * Adding a new widget kind: implement a React component + register it here +
 * update the doctrine in `src-tauri/src/companion/templates/constitution.md`
 * so Athena knows the kind is available.
 */
import type { ComponentType } from 'react';

import { ConnectedServicesWidget } from './widgets/ConnectedServicesWidget';
import { DecisionsPanelWidget } from './widgets/DecisionsPanelWidget';
import { PersonaOverviewWidget } from './widgets/PersonaOverviewWidget';
import { MessageSummaryWidget } from './widgets/MessageSummaryWidget';
import { ExecutionFactsWidget } from './widgets/ExecutionFactsWidget';
import { LinkedDecisionsWidget } from './widgets/LinkedDecisionsWidget';
import { LinkedMemoriesWidget } from './widgets/LinkedMemoriesWidget';
import { MetricSparkWidget } from './widgets/MetricSparkWidget';
import { IssueListWidget } from './widgets/IssueListWidget';
import { DecisionLogWidget } from './widgets/DecisionLogWidget';
import { ModelTierChoiceWidget } from './widgets/ModelTierChoiceWidget';
import { ObservabilityPlanWidget } from './widgets/ObservabilityPlanWidget';
import { PersonaReadyWidget } from './widgets/PersonaReadyWidget';
import { PersonaWalkthroughWidget } from './widgets/PersonaWalkthroughWidget';
import { TemplateSuggestionsWidget } from './widgets/TemplateSuggestionsWidget';
import { TextCalloutWidget } from './widgets/TextCalloutWidget';
import { TriggerSetWidget } from './widgets/TriggerSetWidget';
import { UseCaseSetWidget } from './widgets/UseCaseSetWidget';

export interface CockpitWidgetProps {
  /** Free-form config block from Athena's compose_cockpit op. */
  config?: Record<string, unknown>;
  /** Optional title override; widget falls back to its own default. */
  title?: string;
}

export const cockpitWidgetRegistry: Record<string, ComponentType<CockpitWidgetProps>> = {
  persona_overview: PersonaOverviewWidget,
  connected_services: ConnectedServicesWidget,
  decisions_panel: DecisionsPanelWidget,
  // Contextual widgets — composed programmatically by surfaces like the
  // Overview > Messages detail modal's "Play in chat" handler. Athena
  // does not emit these via compose_cockpit; they only render inside
  // a transient contextualCockpit overlay.
  message_summary: MessageSummaryWidget,
  execution_facts: ExecutionFactsWidget,
  linked_decisions: LinkedDecisionsWidget,
  linked_memories: LinkedMemoriesWidget,
  // Generic widgets — Athena populates them directly from connector
  // results or memory; no per-widget data fetch. Lets her shape an
  // explanation visually instead of as a long chat bubble.
  metric_spark: MetricSparkWidget,
  issue_list: IssueListWidget,
  text_callout: TextCalloutWidget,
  // Persona-design walkthrough — Athena's step-by-step plan applying
  // the persona-design best-practices doctrine to a user intent. Emitted
  // via `show_persona_walkthrough`. Long-form markdown; InlineChatCard
  // relaxes its 260px height clamp for this kind so it flows naturally.
  persona_walkthrough: PersonaWalkthroughWidget,
  // Template-match suggestions — fetched on mount via
  // companion_match_templates(intent). Emitted via
  // `show_template_suggestions { intent, limit? }`. Also unclamped in
  // InlineChatCard since 3-5 result rows exceed 260px comfortably.
  template_suggestions: TemplateSuggestionsWidget,
  // Use-case decomposition. Emitted via
  // `show_use_case_set { intent, use_cases: [{label, role, description}] }`.
  // Athena composes the use cases; the widget renders them grouped by
  // golden / variant / out-of-scope role with role-specific accents.
  use_case_set: UseCaseSetWidget,
  // Trigger decomposition — sibling of use_case_set. Emitted via
  // `show_trigger_set { intent, triggers: [{label, source, condition, grain?, idempotency_note?}] }`.
  // Each entry applies cycle-6 doctrine's "one trigger condition → one
  // persona response shape" grain test; the optional grain and
  // idempotency notes surface the design rationale.
  trigger_set: TriggerSetWidget,
  // Model-tier recommendation. Emitted via `show_model_tier_choice
  // { intent, recommended, tiers: [{tier, rationale}] }`. Renders the
  // three tiers (haiku/sonnet/opus) side-by-side with the recommended
  // one accented.
  model_tier_choice: ModelTierChoiceWidget,
  // Observability plan — the 7th readiness item from cycle-6 doctrine.
  // Two sections: error handling (what failures escalate) + success
  // metric (which signal is tracked). Emitted via
  // `show_observability_plan { intent, error_handling, success_metric }`.
  observability_plan: ObservabilityPlanWidget,
  // Decision log — audit trail of design choices made during the
  // conversation. Emitted via `show_decision_log { intent, decisions }`.
  // Each decision has label / choice / rationale; widget renders a
  // vertical timeline.
  decision_log: DecisionLogWidget,
  // End-of-design recap. Emitted via `show_persona_ready { intent,
  // summary, recommended_action }`. Rolls every decomposition into one
  // build-ready summary; primary button commits to the prefill flow
  // (interactive / one_shot) or routes to the template gallery
  // (use_template).
  persona_ready: PersonaReadyWidget,
};

/** Tunes the grid `rowSpan` per widget kind. Multi-row gives long-form
 *  widgets vertical room; dense widgets stay at 2 rows. */
export function cockpitRowSpan(kind: string): number {
  switch (kind) {
    case 'persona_overview':
    case 'decisions_panel':
    case 'linked_decisions':
    case 'linked_memories':
    case 'issue_list':
      return 3;
    case 'metric_spark':
      // KPI tile — short and wide, looks crammed at 2 rows.
      return 2;
    default:
      return 2;
  }
}

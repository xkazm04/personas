// Monitoring dimension — the four grid items and their state machine.
//
// Shared by both prototype variants so the STATE derivation is defined exactly
// once. The variants differ in how they render the state, never in what it is.
//
// The state is the cross of two independent facts, which is the whole point of
// the dimension: the codebase can have a monitoring SDK the operator never
// wired a connector for, and the operator can wire a connector for something
// the codebase does not emit yet. Collapsing those into one "monitored?" flag
// is what made the old row uninformative.
//
//                        │ no connector wired │ connector wired
//   ─────────────────────┼────────────────────┼──────────────────
//   nothing in the code  │ EMPTY              │ NOT_IMPLEMENTED
//   tool in the code     │ UNCONFIRMED        │ OK
//
// NOT_IMPLEMENTED is the actionable one: the operator has declared intent and
// the code has not caught up, so the item offers a Claude deployment that reads
// the wiring and writes the integration.
import type { LucideIcon } from 'lucide-react';
import { Activity, BarChart3, Brain, ScrollText } from 'lucide-react';

import { LLM_TRACKING_SERVICE_TYPES, MONITORING_SERVICE_TYPES } from './connectors';
import type { AppPassport } from '../passportModel';

export type MonitoringState = 'empty' | 'unconfirmed' | 'not_implemented' | 'ok';

/** Monitoring is a property of the deployed app, so every binding lives in the
 *  production slot — the same convention the wall already uses ("a bound
 *  connector watches the deployed app, so it fills the production slot"). */
export const MONITORING_ENV = 'production' as const;

export interface MonitoringItemDef {
  /** `dimension` key for the env-connector table. */
  key: string;
  icon: LucideIcon;
  /** i18n key suffix under `plugins.dev_tools.monitoring_item_*`. */
  labelKey: 'technical' | 'llm' | 'logs' | 'metrics';
  /** Vault service types that can back this item. */
  serviceTypes: string[];
  /** What the codebase shows for this capability; null = nothing detected. */
  detected: (p: AppPassport) => string | null;
}

export const MONITORING_ITEMS: readonly MonitoringItemDef[] = [
  {
    key: 'monitoring',
    icon: Activity,
    labelKey: 'technical',
    serviceTypes: MONITORING_SERVICE_TYPES,
    detected: (p) => p.stack.monitoring.errorTracking,
  },
  {
    key: 'monitoring.llm',
    icon: Brain,
    labelKey: 'llm',
    serviceTypes: LLM_TRACKING_SERVICE_TYPES,
    detected: (p) => p.stack.llmTracking ?? null,
  },
  {
    // Logs and tracing are one item on purpose: every modern platform ships
    // them together, and splitting them produced two rows that were always the
    // same colour. Either signal counts as detected.
    key: 'monitoring.logs',
    icon: ScrollText,
    labelKey: 'logs',
    serviceTypes: MONITORING_SERVICE_TYPES,
    detected: (p) => p.stack.monitoring.logs ?? p.stack.monitoring.tracing,
  },
  {
    key: 'monitoring.metrics',
    icon: BarChart3,
    labelKey: 'metrics',
    serviceTypes: MONITORING_SERVICE_TYPES,
    detected: (p) => p.stack.monitoring.metrics,
  },
];

export function monitoringState(detected: string | null, wired: boolean): MonitoringState {
  if (detected && wired) return 'ok';
  if (detected) return 'unconfirmed';
  if (wired) return 'not_implemented';
  return 'empty';
}

/** Semantic ink per state. `not_implemented` is primary, not a warning: the
 *  operator did the right thing and the codebase owes them work. */
export const STATE_INK: Record<MonitoringState, string> = {
  empty: 'var(--status-neutral)',
  unconfirmed: 'var(--status-warning)',
  not_implemented: 'var(--primary)',
  ok: 'var(--status-success)',
};

/** The Claude deployment for a NOT_IMPLEMENTED item — it reads the operator's
 *  wiring and writes the integration the codebase is missing. */
export function integrationPrompt(itemLabel: string, connectorName: string, serviceType: string): string {
  return [
    `Wire ${itemLabel} into this project using ${connectorName} (${serviceType}).`,
    '',
    'The operator has already bound this connector in the app, so the intent is settled —',
    'what is missing is the code. Add the idiomatic SDK/exporter for this stack, initialise it',
    'at the application entry point, and emit the signals this capability covers.',
    '',
    'Read every credential/DSN/key from an environment variable — never hardcode a secret,',
    'and never read one out of the app.',
    'Add a short setup note (env var name + where it initialises) to the README or CLAUDE.md.',
    'Make sure the project still builds before finishing.',
  ].join('\n');
}

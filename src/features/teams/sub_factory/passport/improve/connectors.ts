// P2 — connector wiring. Maps a passport row to the Personas connector category
// it needs, so we can check the user's vault: is there a connected + healthy
// credential to bind (→ wire it + re-derive), or must they add one first (→ Vault).
// serviceTypes mirror the connector catalog categories; kept as explicit lists so
// it works offline. `bindField` says which DevProject credential slot to set.
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { AppPassport } from '../passportModel';

export interface ConnectorSpec {
  rowKey: string;
  /** Human label for the category (shown in the popover). */
  categoryLabel: string;
  /** Credential serviceTypes that satisfy this row. */
  serviceTypes: string[];
  /** Which DevProject credential slot binding writes. */
  bindField: 'monitoring' | 'pr' | 'llm_tracking';
  /** The row's gap exists (so wiring a connector is offered). */
  applicable: (p: AppPassport) => boolean;
}

const MONITORING_SERVICE_TYPES = [
  'sentry', 'betterstack', 'better_stack', 'datadog', 'rollbar', 'bugsnag',
  'newrelic', 'new_relic', 'honeybadger', 'grafana', 'grafana_cloud', 'pingdom',
  'logtail', 'axiom', 'highlight', 'uptimerobot', 'uptime_robot',
];

// LLM-observability / tracing platforms — distinct vault category from app
// monitoring (bound to its own DevProject slot).
const LLM_TRACKING_SERVICE_TYPES = [
  'langfuse', 'helicone', 'langsmith', 'arize', 'phoenix', 'braintrust',
  'portkey', 'wandb', 'weights_and_biases', 'lunary', 'langwatch', 'openllmetry',
  'posthog_llm', 'traceloop', 'baseten',
];

export const CONNECTOR_SPECS: Record<string, ConnectorSpec> = {
  observability: {
    rowKey: 'observability',
    categoryLabel: 'monitoring / error-tracking',
    serviceTypes: MONITORING_SERVICE_TYPES,
    bindField: 'monitoring',
    applicable: (p) => p.productionReadiness.observability.level === 'none',
  },
  aiflow: {
    rowKey: 'aiflow',
    categoryLabel: 'source control (GitHub)',
    serviceTypes: ['github'],
    bindField: 'pr',
    applicable: (p) => !p.automationReadiness.aiInWorkflow,
  },
  // Stack/Tooling monitoring rows — the same vault categories as Observability,
  // each bound to the single project monitoring slot. A modern monitoring
  // platform (Datadog/Grafana/Sentry/…) covers error-tracking, logs, metrics and
  // tracing, so binding one lights up all four rows (see passportDerive).
  errors: {
    rowKey: 'errors',
    categoryLabel: 'error tracking',
    serviceTypes: MONITORING_SERVICE_TYPES,
    bindField: 'monitoring',
    applicable: (p) => !p.stack.monitoring.errorTracking,
  },
  logs: {
    rowKey: 'logs',
    categoryLabel: 'logging',
    serviceTypes: MONITORING_SERVICE_TYPES,
    bindField: 'monitoring',
    applicable: (p) => !p.stack.monitoring.logs,
  },
  metrics: {
    rowKey: 'metrics',
    categoryLabel: 'metrics',
    serviceTypes: MONITORING_SERVICE_TYPES,
    bindField: 'monitoring',
    applicable: (p) => !p.stack.monitoring.metrics,
  },
  tracing: {
    rowKey: 'tracing',
    categoryLabel: 'tracing',
    serviceTypes: MONITORING_SERVICE_TYPES,
    bindField: 'monitoring',
    applicable: (p) => !p.stack.monitoring.tracing,
  },
  // LLM tracking — its own credential slot, like monitoring but for LLM-obs.
  llmtracking: {
    rowKey: 'llmtracking',
    categoryLabel: 'LLM observability (Langfuse / Helicone / LangSmith / …)',
    serviceTypes: LLM_TRACKING_SERVICE_TYPES,
    bindField: 'llm_tracking',
    applicable: (p) => !p.stack.llmTracking,
  },
};

export function connectorSpecFor(rowKey: string): ConnectorSpec | null {
  return CONNECTOR_SPECS[rowKey] ?? null;
}

/** The user's credentials whose serviceType satisfies the spec. */
export function candidateCredentials(creds: PersonaCredential[], spec: ConnectorSpec): PersonaCredential[] {
  const set = new Set(spec.serviceTypes);
  return creds.filter((c) => set.has(c.serviceType.toLowerCase()));
}

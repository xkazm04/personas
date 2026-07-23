// P2 — connector wiring. Maps a passport row to the Personas connector category
// it needs, so we can check the user's vault: is there a connected + healthy
// credential to bind (→ wire it + re-derive), or must they add one first (→ Vault).
// serviceTypes mirror the connector catalog categories; kept as explicit lists so
// it works offline. `bindField` says which DevProject credential slot to set.
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { BUILTIN_CONNECTORS } from '@/lib/credentials/builtinConnectors';
import type { AppPassport } from '../passportModel';

export interface ConnectorSpec {
  rowKey: string;
  /** Human label for the category (shown in the popover). */
  categoryLabel: string;
  /** Credential serviceTypes that satisfy this row. */
  serviceTypes: string[];
  /** Which DevProject credential slot binding writes. */
  bindField: 'monitoring' | 'pr' | 'llm_tracking' | 'support';
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
  'langfuse', 'helicone', 'langsmith', 'tracklight', 'arize', 'phoenix', 'braintrust',
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
  // The env-split Monitoring row — same category + slot as the capability rows
  // below; wiring a connector fills the production slot (see passportDerive).
  monitoring: {
    rowKey: 'monitoring',
    categoryLabel: 'monitoring / error-tracking',
    serviceTypes: MONITORING_SERVICE_TYPES,
    bindField: 'monitoring',
    applicable: (p) => !p.stack.monitoring.errorTracking,
  },
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
  // Support — the incoming customer-support channel (its own credential slot).
  // Always applicable so an already-bound channel can be switched.
  support: {
    rowKey: 'support',
    categoryLabel: 'customer-support channel (Email / Discord)',
    serviceTypes: ['discord', 'gmail', 'microsoft_outlook'],
    bindField: 'support',
    applicable: () => true,
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

/** A catalog tool the row can wire — a builtin connector whose name the spec accepts. */
export interface CatalogTool {
  /** Connector name — also the credential serviceType we match on. */
  name: string;
  label: string;
  color: string;
  iconUrl: string | null;
}

/**
 * The supported tools for a row, drawn from the builtin connector catalog:
 * every connector whose `name` is one of the spec's accepted serviceTypes.
 * Drives the icon grid in ConnectorSection — deduped, catalog order preserved.
 * Because we match on `name`, an icon here is always an actually-addable tool.
 */
export function catalogToolsFor(spec: ConnectorSpec): CatalogTool[] {
  const set = new Set(spec.serviceTypes.map((s) => s.toLowerCase()));
  const seen = new Set<string>();
  const tools: CatalogTool[] = [];
  for (const c of BUILTIN_CONNECTORS) {
    const key = c.name.toLowerCase();
    if (!set.has(key) || seen.has(key)) continue;
    seen.add(key);
    tools.push({ name: c.name, label: c.label ?? c.name, color: c.color ?? '#6B7280', iconUrl: c.icon_url ?? null });
  }
  return tools;
}

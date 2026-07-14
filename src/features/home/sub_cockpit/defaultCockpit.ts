/**
 * Deterministic default cockpit — composed in TS from real fleet state, with
 * NO LLM call. The persistent cockpit is normally composed by Athena via
 * `compose_cockpit`; until the user has ever chatted, `companion_get_cockpit`
 * returns null and the panel would show only a "talk to Athena" CTA. That
 * leaves a 32-widget registry earning nothing for users who never open chat.
 *
 * `composeDefaultCockpit` builds a sensible starter layout (orientation
 * callout · fleet vitals · persona roster · needs-attention triage) purely
 * from data already reachable client-side (personas + the metrics summary).
 * Athena's composed spec always takes PRECEDENCE when present — this is the
 * fallback, and the panel labels it as such.
 *
 * Pure + framework-free so it can be unit-tested: all user-facing strings are
 * passed in via {@link DefaultCockpitLabels} (already localized by the caller),
 * and the function owns only the LOGIC — counts, intents, ordering, and which
 * personas surface as attention items.
 */
import type { Persona } from '@/lib/bindings/Persona';
import type { MetricsSummary } from '@/lib/bindings/MetricsSummary';
import type { CompanionCockpitSpecBody, CompanionCockpitWidget } from '@/api/companion';

import { attentionFor } from './widgets/personaStats';
import { fleetSuccessRatePct } from '../sub_welcome/lib/fleetHealth';

/** Localized labels the composer slots into the widget specs. */
export interface DefaultCockpitLabels {
  /** Grid title (also used for the header). */
  title: string;
  callout: { title: string; body: string };
  vitalsTitle: string;
  rosterTitle: string;
  attentionTitle: string;
  attentionEmpty: string;
  stat: {
    activePersonas: string;
    successRate: string;
    executions: string;
    needsAttention: string;
  };
  /** Localized attention reasons, keyed by the {@link attentionFor} `kind`. */
  attentionReason: {
    setup: string;
    disabled: string;
    low_trust: string;
  };
}

/** Success-rate → stat intent. Mirrors the FleetHealthStrip red/amber policy. */
function successIntent(rate: number | null): 'default' | 'good' | 'warn' | 'bad' {
  if (rate === null) return 'default';
  if (rate >= 80) return 'good';
  if (rate >= 50) return 'warn';
  return 'bad';
}

/** Max attention rows surfaced in the triage widget. */
const ATTENTION_LIMIT = 6;

/**
 * Compose the deterministic default cockpit body from fleet state.
 *
 * Returns a 4-widget layout: an orientation callout, a fleet-vitals stat grid,
 * the persona-overview hero (which self-fetches its own persona data), and a
 * needs-attention issue list. Widget ids are stable so React reconciles across
 * re-composes without remounting.
 */
export function composeDefaultCockpit(
  personas: Persona[],
  metrics: MetricsSummary | null,
  labels: DefaultCockpitLabels,
): CompanionCockpitSpecBody {
  const activeCount = personas.filter((p) => p.enabled !== false).length;

  const attention = personas
    .map((p) => ({ p, flag: attentionFor(p) }))
    .filter((x): x is { p: Persona; flag: NonNullable<ReturnType<typeof attentionFor>> } =>
      x.flag !== null,
    );

  const successRate = metrics
    ? fleetSuccessRatePct(metrics.successfulExecutions, metrics.failedExecutions)
    : null;

  const reasonLabel = (kind: 'setup' | 'disabled' | 'low_trust'): string =>
    kind === 'setup'
      ? labels.attentionReason.setup
      : kind === 'disabled'
        ? labels.attentionReason.disabled
        : labels.attentionReason.low_trust;

  const widgets: CompanionCockpitWidget[] = [
    {
      id: 'default-callout',
      kind: 'text_callout',
      title: labels.callout.title,
      span: 12,
      config: { body: labels.callout.body, intent: 'info' },
    },
    {
      id: 'default-vitals',
      kind: 'stat_grid',
      title: labels.vitalsTitle,
      span: 12,
      config: {
        columns: 4,
        stats: [
          { label: labels.stat.activePersonas, value: activeCount },
          {
            label: labels.stat.successRate,
            value: successRate ?? '—',
            unit: successRate !== null ? '%' : undefined,
            intent: successIntent(successRate),
          },
          { label: labels.stat.executions, value: metrics?.totalExecutions ?? 0 },
          {
            label: labels.stat.needsAttention,
            value: attention.length,
            intent: attention.length === 0 ? 'good' : 'warn',
          },
        ],
      },
    },
    {
      id: 'default-roster',
      kind: 'persona_overview',
      title: labels.rosterTitle,
      span: 12,
      config: { limit: 6, filter: 'active' },
    },
    {
      id: 'default-attention',
      kind: 'issue_list',
      title: labels.attentionTitle,
      span: 12,
      config: {
        empty_label: labels.attentionEmpty,
        items: attention.slice(0, ATTENTION_LIMIT).map(({ p, flag }) => ({
          id: p.id,
          title: p.name,
          sublabel: reasonLabel(flag.kind),
          severity: flag.tone === 'bad' ? 'bad' : 'warn',
        })),
      },
    },
  ];

  return { title: labels.title, widgets };
}

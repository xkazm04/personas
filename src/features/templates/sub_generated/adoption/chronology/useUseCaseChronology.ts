/**
 * Builds a per-use-case chronology from a template's design result.
 *
 * Each "chronology row" ties together:
 *   - the use case (id, title, capability_summary, description)
 *   - its triggers  (when it runs)          — resolved via `use_case_id` (v2)
 *                                             or positional fallback (v1)
 *   - its connectors (apps & services it uses) — resolved via `use_case_id`
 *                                             or `related_triggers` indices,
 *                                             else shared across all rows
 *
 * This is the data contract consumed by both experimental prototypes
 * (Journey Cards + Timeline Stepper) so they stay in visual sync.
 */
import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';

export interface ChronologyTrigger {
  trigger_type: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface ChronologyConnector {
  name: string;
  label?: string;
  purpose?: string;
  role?: string;
}

export interface ChronologyStep {
  id: string;
  label: string;
  detail?: string;
  type?: string;
  connector?: string;
}

export interface ChronologyRow {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  enabled: boolean;
  triggers: ChronologyTrigger[];
  connectors: ChronologyConnector[];
  steps: ChronologyStep[];
  shared: boolean;
}

const TRIGGER_TYPE_ALIASES: Record<string, string> = {
  event: 'event_listener',
  event_bus: 'event_listener',
  event_sub: 'event_listener',
  event_subscription: 'event_listener',
  cron: 'schedule',
  scheduled: 'schedule',
  timer: 'schedule',
  poll: 'polling',
  hook: 'webhook',
  http: 'webhook',
};

function normalizeTriggerType(raw: string): string {
  return TRIGGER_TYPE_ALIASES[raw] ?? raw;
}

function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asObj(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object') ? (v as Record<string, unknown>) : {};
}

/** Build the chronology view from the raw designResult object. */
export function buildChronology(designResult: Record<string, unknown> | null | undefined): ChronologyRow[] {
  if (!designResult) return [];

  const d = designResult;

  // -- Use cases: try multiple shapes --
  const ucRaw = (d.use_cases ?? d.use_case_flows ?? []) as unknown[];
  const designCtx = asObj(d.design_context);
  const ctxUcs = Array.isArray(designCtx.use_cases) ? (designCtx.use_cases as unknown[]) : [];
  const useCases = ucRaw.length > 0 ? ucRaw : ctxUcs;

  const triggers = ((d.suggested_triggers ?? d.triggers ?? []) as unknown[]).map((t) => asObj(t));
  const connectors = ((d.suggested_connectors ?? d.required_connectors ?? []) as unknown[]).map((c) => asObj(c));

  // If no use cases at all, synthesize a single "default" row so the
  // prototype still shows triggers + connectors somewhere.
  if (useCases.length === 0) {
    return [{
      id: 'default',
      title: asStr(d.name, 'Default Capability'),
      summary: asStr(d.description),
      description: undefined,
      enabled: true,
      triggers: triggers.map((t) => ({
        trigger_type: normalizeTriggerType(asStr(t.trigger_type, 'manual')),
        description: asStr(t.description),
        config: asObj(t.config),
      })),
      connectors: connectors.map((c) => ({
        name: asStr(c.name ?? c.service_type ?? c.label),
        label: asStr(c.label ?? c.name),
        purpose: asStr(c.purpose ?? c.description),
        role: asStr(c.role),
      })),
      steps: [],
      shared: true,
    }];
  }

  return useCases.map((uc, idx) => {
    const o = asObj(uc);
    const id = asStr(o.id, `uc_${idx}`);
    const title = asStr(o.title ?? o.name, `Use case ${idx + 1}`);
    const summary = asStr(o.capability_summary ?? o.description);
    const description = asStr(o.description);
    const enabled = o.enabled_by_default === false ? false : true;

    // -- Trigger linkage --
    // v2: triggers carry `use_case_id` → exact match
    // v2 authoring hint: the use case may carry a `suggested_trigger` object
    // v1 fallback: if only 1 use case, attribute all; else empty
    const linkedTriggers: ChronologyTrigger[] = [];
    let hasExplicitTriggerLink = false;
    for (const t of triggers) {
      if (asStr(t.use_case_id) === id) {
        hasExplicitTriggerLink = true;
        linkedTriggers.push({
          trigger_type: normalizeTriggerType(asStr(t.trigger_type, 'manual')),
          description: asStr(t.description),
          config: asObj(t.config),
        });
      }
    }
    // Fallback: authoring hint on the use case
    if (!hasExplicitTriggerLink && o.suggested_trigger) {
      const st = asObj(o.suggested_trigger);
      linkedTriggers.push({
        trigger_type: normalizeTriggerType(asStr(st.trigger_type, 'manual')),
        description: asStr(st.description),
        config: asObj(st.config),
      });
    }

    // -- Connector linkage --
    // v2: connectors carry `use_case_id`
    // v1 partial: `related_triggers: [idx]` lets us trace via trigger index
    const linkedConnectors: ChronologyConnector[] = [];
    for (const c of connectors) {
      if (asStr(c.use_case_id) === id) {
        linkedConnectors.push({
          name: asStr(c.name ?? c.service_type),
          label: asStr(c.label ?? c.name),
          purpose: asStr(c.purpose ?? c.description),
          role: asStr(c.role),
        });
      }
    }

    // -- Step linkage (from use_case_flow.nodes) --
    const nodes = Array.isArray(o.nodes) ? (o.nodes as unknown[]) : [];
    const steps: ChronologyStep[] = nodes.map((n, nIdx) => {
      const nObj = asObj(n);
      return {
        id: asStr(nObj.id, `n${nIdx}`),
        label: asStr(nObj.label, `Step ${nIdx + 1}`),
        detail: asStr(nObj.detail),
        type: asStr(nObj.type),
        connector: asStr(nObj.connector),
      };
    });

    return {
      id,
      title,
      summary,
      description,
      enabled,
      triggers: linkedTriggers,
      connectors: linkedConnectors,
      steps,
      shared: false,
    };
  }).map((row) => {
    // -- v1 fallback: single use case → attribute everything --
    if (useCases.length === 1) {
      if (row.triggers.length === 0) {
        row.triggers = triggers.map((t) => ({
          trigger_type: normalizeTriggerType(asStr(t.trigger_type, 'manual')),
          description: asStr(t.description),
          config: asObj(t.config),
        }));
      }
      if (row.connectors.length === 0) {
        row.connectors = connectors.map((c) => ({
          name: asStr(c.name ?? c.service_type),
          label: asStr(c.label ?? c.name),
          purpose: asStr(c.purpose ?? c.description),
          role: asStr(c.role),
        }));
        row.shared = connectors.length > 0;
      }
      return row;
    }

    // -- Multi use case + no linkage: surface connectors that have no
    // use_case_id anywhere as "shared across all" --
    if (row.connectors.length === 0) {
      const orphanConnectors = connectors.filter((c) => !asStr(c.use_case_id));
      // Only attach orphans if NO connector in the set has a use_case_id;
      // otherwise they're a shared pool and each row shows them all.
      const anyLinked = connectors.some((c) => !!asStr(c.use_case_id));
      if (!anyLinked) {
        row.connectors = orphanConnectors.map((c) => ({
          name: asStr(c.name ?? c.service_type),
          label: asStr(c.label ?? c.name),
          purpose: asStr(c.purpose ?? c.description),
          role: asStr(c.role),
        }));
        row.shared = row.connectors.length > 0;
      }
    }
    return row;
  });
}

/** Hook wrapper. Reads the current adoption buildDraft and memoizes chronology. */
export function useUseCaseChronology(): ChronologyRow[] {
  const buildDraft = useAgentStore((s) => s.buildDraft);
  return useMemo(
    () => buildChronology(buildDraft as Record<string, unknown> | null),
    [buildDraft],
  );
}

/**
 * Builds a per-use-case chronology from a template's design result.
 *
 * Each "chronology row" ties together all 8 dimensions:
 *   trigger · task · connector · message · review · memory · event · error
 *
 * Presence levels per dimension:
 *   "linked" — resolved to THIS use case via explicit use_case_id or per-
 *              capability config (most informative)
 *   "shared" — exists on the template but lives at the top level, so it
 *              applies to every capability equally
 *   "none"   — not configured on the template
 */
import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import type { UseCaseFlow, FlowNode, FlowEdge } from '@/lib/types/frontendTypes';

export type DimensionPresence = 'linked' | 'shared' | 'none';

export const CHAIN_DIMENSIONS = [
  'trigger',
  'task',
  'connector',
  'message',
  'review',
  'memory',
  'event',
  'error',
] as const;
export type DimensionKey = (typeof CHAIN_DIMENSIONS)[number];

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

export interface ChronologyEvent {
  event_type: string;
  description?: string;
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
  events: ChronologyEvent[];
  messageSummary?: string;
  reviewSummary?: string;
  memorySummary?: string;
  errorSummary?: string;
  presence: Record<DimensionKey, DimensionPresence>;
  /** True when connectors are shared across all use cases (v1 pool). */
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

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Template-global dimension snapshot — same across all rows. */
interface TemplateShared {
  messageSummary?: string;
  reviewSummary?: string;
  memorySummary?: string;
  errorSummary?: string;
  eventsShared: ChronologyEvent[];
  messagePresent: boolean;
  reviewPresent: boolean;
  memoryPresent: boolean;
  errorPresent: boolean;
  eventsPresent: boolean;
}

function extractTemplateShared(d: Record<string, unknown>): TemplateShared {
  const channels = asArray(d.suggested_notification_channels);
  const messageSummary = channels.length > 0
    ? channels.map((ch) => {
      const o = asObj(ch);
      return `${asStr(o.type, 'built-in')}: ${asStr(o.description, 'notifications')}`;
    }).join(' · ')
    : undefined;

  const caps = asArray(d.protocol_capabilities).map(asObj);
  const reviewCaps = caps.filter((c) => asStr(c.type) === 'manual_review');
  const memoryCaps = caps.filter((c) => asStr(c.type) === 'agent_memory');
  const reviewSummary = reviewCaps.length > 0
    ? reviewCaps.map((c) => asStr(c.context, 'Review required')).join(' · ')
    : undefined;
  const memorySummary = memoryCaps.length > 0
    ? memoryCaps.map((c) => asStr(c.context, 'Memory enabled')).join(' · ')
    : undefined;

  const sp = asObj(d.structured_prompt);
  const errorText = asStr(sp.errorHandling);
  const errorSummary = errorText ? errorText.split('\n').find(Boolean)?.slice(0, 160) : undefined;

  const events = asArray(d.suggested_event_subscriptions).map(asObj);
  const eventsShared = events.map((e) => ({
    event_type: asStr(e.event_type, 'event'),
    description: asStr(e.description),
  }));

  return {
    messageSummary,
    reviewSummary,
    memorySummary,
    errorSummary,
    eventsShared,
    messagePresent: !!messageSummary,
    reviewPresent: !!reviewSummary,
    memoryPresent: !!memorySummary,
    errorPresent: !!errorSummary,
    eventsPresent: eventsShared.length > 0,
  };
}

/* ─── v3 reader ──────────────────────────────────────────────────────
 * Templates that declare `schema_version >= 3` (or have `payload.persona`
 * + `payload.use_cases[i].suggested_trigger` — the nested shape) route
 * through this path. Every chain artefact is already attached to its
 * capability; no guessing required.
 */
function isV3Shape(d: Record<string, unknown>): boolean {
  const schemaVersion = typeof d.schema_version === 'number' ? d.schema_version : 0;
  if (schemaVersion >= 3) return true;
  // Heuristic: nested shape detected without explicit version marker.
  const payload = asObj(d.payload);
  const ucs = asArray(payload.use_cases).length > 0 ? asArray(payload.use_cases) : asArray(d.use_cases);
  return ucs.some((uc) => {
    const o = asObj(uc);
    return !!o.suggested_trigger || !!o.review_policy || !!o.memory_policy;
  });
}

function buildChronologyV3(d: Record<string, unknown>): ChronologyRow[] {
  // v3 lives under `payload` in the template; adoption pipeline may also
  // surface the same structure at the top level of the designResult.
  const payload = asObj(d.payload);
  const root = Object.keys(payload).length > 0 ? payload : d;

  const persona = asObj(root.persona);
  const useCases = asArray(root.use_cases).map(asObj);
  const personaConnectors = asArray(persona.connectors).map(asObj);

  // Persona-wide fallback summaries — used when a capability inherits.
  const defaultChannels = asArray(persona.notification_channels_default).map(asObj);
  const defaultChannelSummary = defaultChannels.length > 0
    ? defaultChannels.map((ch) => `${asStr(ch.type, 'built-in')}: ${asStr(ch.description, 'notifications')}`).join(' · ')
    : undefined;
  const personaErrorHandling = asStr(persona.error_handling);

  return useCases.map((uc, idx) => {
    const id = asStr(uc.id, `uc_${idx}`);
    const title = asStr(uc.title ?? uc.name, `Use case ${idx + 1}`);
    const summary = asStr(uc.capability_summary ?? uc.description);
    const description = asStr(uc.description);
    const enabled = uc.enabled_by_default === false ? false : true;

    // Trigger — capability owns a single suggested_trigger object.
    const triggerObj = asObj(uc.suggested_trigger);
    const hasTrigger = Object.keys(triggerObj).length > 0;
    const triggers: ChronologyTrigger[] = hasTrigger
      ? [{
        trigger_type: normalizeTriggerType(asStr(triggerObj.trigger_type, 'manual')),
        description: asStr(triggerObj.description),
        config: asObj(triggerObj.config),
      }]
      : [];

    // Connectors — capability references names from persona.connectors.
    const connectorRefs = asArray(uc.connectors).map((c) => asStr(c));
    const connectors: ChronologyConnector[] = connectorRefs.map((name) => {
      const meta = personaConnectors.find((pc) => asStr(pc.name) === name) ?? {};
      return {
        name,
        label: asStr(meta.label, name),
        purpose: asStr(meta.role ?? meta.category),
        role: asStr(meta.role),
      };
    });

    // Notification channels — capability's own or persona fallback.
    const capChannels = asArray(uc.notification_channels).map(asObj);
    const capChannelSummary = capChannels.length > 0
      ? capChannels.map((ch) => `${asStr(ch.type, 'built-in')}: ${asStr(ch.description, 'notifications')}`).join(' · ')
      : undefined;
    const messageSummary = capChannelSummary ?? defaultChannelSummary;
    const messagePresence: DimensionPresence = capChannelSummary
      ? 'linked'
      : (defaultChannelSummary ? 'shared' : 'none');

    // Review / Memory policies — per-capability.
    const reviewObj = asObj(uc.review_policy);
    const reviewMode = asStr(reviewObj.mode);
    const reviewPresent = !!reviewMode && reviewMode !== 'never';
    const reviewSummary = reviewPresent
      ? `${reviewMode}${reviewObj.context ? `: ${asStr(reviewObj.context)}` : ''}`
      : undefined;

    const memoryObj = asObj(uc.memory_policy);
    const memoryEnabled = memoryObj.enabled === true;
    const memorySummary = memoryEnabled ? asStr(memoryObj.context, 'Memory enabled') : undefined;

    // Events — capability-scoped, separated by direction.
    const eventSubs = asArray(uc.event_subscriptions).map(asObj);
    const events: ChronologyEvent[] = eventSubs.map((e) => ({
      event_type: asStr(e.event_type, 'event'),
      description: asStr(e.description),
    }));
    const eventPresence: DimensionPresence = events.length > 0 ? 'linked' : 'none';

    // Error handling — per-capability or persona fallback.
    const capError = asStr(uc.error_handling);
    const errorSummary = capError || personaErrorHandling || undefined;
    const errorPresence: DimensionPresence = capError
      ? 'linked'
      : (personaErrorHandling ? 'shared' : 'none');

    // Flow steps — v3 puts them under use_case_flow.nodes.
    const flow = asObj(uc.use_case_flow);
    const nodes = asArray(flow.nodes);
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
      triggers,
      connectors,
      steps,
      events,
      messageSummary,
      reviewSummary,
      memorySummary,
      errorSummary,
      presence: {
        trigger: hasTrigger ? 'linked' : 'none',
        task: 'linked',
        connector: connectors.length > 0 ? 'linked' : 'none',
        message: messagePresence,
        review: reviewPresent ? 'linked' : 'none',
        memory: memoryEnabled ? 'linked' : 'none',
        event: eventPresence,
        error: errorPresence,
      },
      shared: false,
    };
  });
}

/** Build the chronology view from the raw designResult object. */
export function buildChronology(designResult: Record<string, unknown> | null | undefined): ChronologyRow[] {
  if (!designResult) return [];

  const d = designResult;

  // Prefer the nested v3 reader when the template declares the new shape.
  if (isV3Shape(d)) return buildChronologyV3(d);

  const shared = extractTemplateShared(d);

  const ucRaw = asArray(d.use_cases).length > 0 ? asArray(d.use_cases) : asArray(d.use_case_flows);
  const designCtx = asObj(d.design_context);
  const ctxUcs = asArray(designCtx.use_cases);
  const useCases = ucRaw.length > 0 ? ucRaw : ctxUcs;

  const triggers = asArray(d.suggested_triggers).length > 0
    ? asArray(d.suggested_triggers).map(asObj)
    : asArray(d.triggers).map(asObj);
  const connectors = asArray(d.suggested_connectors).length > 0
    ? asArray(d.suggested_connectors).map(asObj)
    : asArray(d.required_connectors).map(asObj);

  const singleCapability = useCases.length <= 1;

  // Fallback row when no use cases at all — synthesize from template meta.
  if (useCases.length === 0) {
    const row: ChronologyRow = {
      id: 'default',
      title: asStr(d.name, 'Default Capability'),
      summary: asStr(d.description),
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
      events: shared.eventsShared,
      messageSummary: shared.messageSummary,
      reviewSummary: shared.reviewSummary,
      memorySummary: shared.memorySummary,
      errorSummary: shared.errorSummary,
      presence: {
        trigger: triggers.length > 0 ? 'linked' : 'none',
        task: 'linked',
        connector: connectors.length > 0 ? 'linked' : 'none',
        message: shared.messagePresent ? 'shared' : 'none',
        review: shared.reviewPresent ? 'shared' : 'none',
        memory: shared.memoryPresent ? 'shared' : 'none',
        event: shared.eventsPresent ? 'linked' : 'none',
        error: shared.errorPresent ? 'shared' : 'none',
      },
      shared: false,
    };
    return [row];
  }

  return useCases.map((uc, idx) => {
    const o = asObj(uc);
    const id = asStr(o.id, `uc_${idx}`);
    const title = asStr(o.title ?? o.name, `Use case ${idx + 1}`);
    const summary = asStr(o.capability_summary ?? o.description);
    const description = asStr(o.description);
    const enabled = o.enabled_by_default === false ? false : true;

    // -- Trigger linkage --
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
    if (!hasExplicitTriggerLink && o.suggested_trigger) {
      const st = asObj(o.suggested_trigger);
      linkedTriggers.push({
        trigger_type: normalizeTriggerType(asStr(st.trigger_type, 'manual')),
        description: asStr(st.description),
        config: asObj(st.config),
      });
    }
    if (!hasExplicitTriggerLink && singleCapability && linkedTriggers.length === 0) {
      for (const t of triggers) {
        linkedTriggers.push({
          trigger_type: normalizeTriggerType(asStr(t.trigger_type, 'manual')),
          description: asStr(t.description),
          config: asObj(t.config),
        });
      }
    }

    // -- Connector linkage --
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
    const anyConnectorLinked = connectors.some((c) => !!asStr(c.use_case_id));
    let connectorShared = false;
    if (linkedConnectors.length === 0) {
      // v1 fallback: single capability or nothing linked → attribute all.
      if (singleCapability || !anyConnectorLinked) {
        for (const c of connectors) {
          linkedConnectors.push({
            name: asStr(c.name ?? c.service_type),
            label: asStr(c.label ?? c.name),
            purpose: asStr(c.purpose ?? c.description),
            role: asStr(c.role),
          });
        }
        connectorShared = !singleCapability && linkedConnectors.length > 0;
      }
    }

    // -- Per-capability events (v2) or fallback to template-shared events --
    const capEvents = asArray(o.event_subscriptions).map((e) => {
      const eo = asObj(e);
      return {
        event_type: asStr(eo.event_type ?? eo.type, 'event'),
        description: asStr(eo.description),
      } as ChronologyEvent;
    });
    const rowEvents = capEvents.length > 0 ? capEvents : shared.eventsShared;
    const eventPresence: DimensionPresence =
      capEvents.length > 0 ? 'linked' : (shared.eventsPresent ? 'shared' : 'none');

    // -- Per-capability notification_channels / memory (v2) overrides --
    const capChannels = asArray(o.notification_channels);
    const capChannelSummary = capChannels.length > 0
      ? capChannels.map((ch) => {
        const co = asObj(ch);
        return `${asStr(co.type, 'built-in')}: ${asStr(co.description, 'notifications')}`;
      }).join(' · ')
      : undefined;
    const messageSummary = capChannelSummary ?? shared.messageSummary;
    const messagePresence: DimensionPresence =
      capChannelSummary ? 'linked' : (shared.messagePresent ? 'shared' : 'none');

    // -- Step linkage --
    const nodes = asArray(o.nodes);
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

    const triggerPresence: DimensionPresence =
      linkedTriggers.length > 0
        ? (hasExplicitTriggerLink || o.suggested_trigger ? 'linked' : 'shared')
        : 'none';
    const connectorPresence: DimensionPresence =
      linkedConnectors.length > 0
        ? (connectorShared ? 'shared' : 'linked')
        : 'none';

    return {
      id,
      title,
      summary,
      description,
      enabled,
      triggers: linkedTriggers,
      connectors: linkedConnectors,
      steps,
      events: rowEvents,
      messageSummary,
      reviewSummary: shared.reviewSummary,
      memorySummary: shared.memorySummary,
      errorSummary: shared.errorSummary,
      presence: {
        trigger: triggerPresence,
        task: 'linked',
        connector: connectorPresence,
        message: messagePresence,
        review: shared.reviewPresent ? 'shared' : 'none',
        memory: shared.memoryPresent ? 'shared' : 'none',
        event: eventPresence,
        error: shared.errorPresent ? 'shared' : 'none',
      },
      shared: connectorShared,
    };
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

/* ── Flow lookup ─────────────────────────────────────────────────────
 * Returns a map keyed by use-case id → UseCaseFlow with full nodes+edges.
 * Used by the Wildcard variant to open ActivityDiagramModal scoped to a
 * single capability. The hook stays minimal on purpose: it reads the same
 * buildDraft the chronology hook does and extracts the subset needed by
 * the diagram modal, so both views stay consistent.
 */
const FLOW_NODE_TYPES: ReadonlyArray<FlowNode['type']> =
  ['start', 'end', 'action', 'decision', 'connector', 'event', 'error'];

function coerceNodeType(raw: string): FlowNode['type'] {
  return (FLOW_NODE_TYPES as readonly string[]).includes(raw)
    ? (raw as FlowNode['type'])
    : 'action';
}

export function buildFlowLookup(draft: Record<string, unknown> | null): Map<string, UseCaseFlow> {
  const out = new Map<string, UseCaseFlow>();
  if (!draft) return out;
  const d = draft as Record<string, unknown>;

  const raw = asArray(d.use_case_flows).length > 0
    ? asArray(d.use_case_flows)
    : asArray(d.use_cases);

  for (const uc of raw) {
    const o = asObj(uc);
    const id = asStr(o.id);
    if (!id) continue;
    const nodesRaw = asArray(o.nodes);
    const edgesRaw = asArray(o.edges);
    if (nodesRaw.length === 0) continue;

    const nodes: FlowNode[] = nodesRaw.map((n, i) => {
      const no = asObj(n);
      return {
        id: asStr(no.id, `n${i}`),
        type: coerceNodeType(asStr(no.type, 'action')),
        label: asStr(no.label, `Step ${i + 1}`),
        detail: asStr(no.detail) || undefined,
        connector: asStr(no.connector) || undefined,
      };
    });
    const edges: FlowEdge[] = edgesRaw.map((e, i) => {
      const eo = asObj(e);
      return {
        id: asStr(eo.id, `e${i}`),
        source: asStr(eo.source),
        target: asStr(eo.target),
        label: asStr(eo.label) || undefined,
      };
    }).filter((e) => e.source && e.target);

    out.set(id, {
      id,
      name: asStr(o.name ?? o.title, id),
      description: asStr(o.description),
      nodes,
      edges,
    });
  }
  return out;
}

export function useUseCaseFlows(): Map<string, UseCaseFlow> {
  const buildDraft = useAgentStore((s) => s.buildDraft);
  return useMemo(
    () => buildFlowLookup(buildDraft as Record<string, unknown> | null),
    [buildDraft],
  );
}

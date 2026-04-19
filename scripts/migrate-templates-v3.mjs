#!/usr/bin/env node
/**
 * Mechanical v2 → v3 template migrator.
 *
 * Usage:
 *   node scripts/migrate-templates-v3.mjs --dry-run         # show diffs, no writes
 *   node scripts/migrate-templates-v3.mjs --only=<id>       # single template
 *   node scripts/migrate-templates-v3.mjs                   # apply everywhere
 *
 * Rules (see docs/concepts/persona-capabilities/C3-template-schema-v3.md):
 *   - payload.suggested_tools           → payload.persona.tools
 *   - payload.suggested_connectors      → payload.persona.connectors
 *   - payload.suggested_notification_channels → payload.persona.notification_channels_default
 *     (when global) OR payload.use_cases[i].notification_channels
 *   - payload.suggested_triggers[i]     → payload.use_cases[j].suggested_trigger
 *       (paired by use_case_id; positional fallback when counts match)
 *   - payload.suggested_event_subscriptions → payload.use_cases[j].event_subscriptions
 *       (paired by use_case_id; global entries retained on persona)
 *   - payload.use_case_flows[i]         → payload.use_cases[i] with nested
 *                                         use_case_flow { nodes, edges }
 *   - payload.structured_prompt         → decomposed into payload.persona
 *     (identity.role / identity.description / operating_instructions /
 *      tool_guidance / error_handling)
 *   - payload.protocol_capabilities     → per-capability review_policy / memory_policy
 *   - Adds TODO markers where hand-authoring is still required
 *     (voice.style, principles, constraints, decision_principles).
 *
 * Safe: always writes to the in-memory structure, then diffs/writes files.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const TEMPLATES_DIR = join(ROOT, 'scripts', 'templates');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').replace('--only=', '').trim();

function findJsonFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...findJsonFiles(p));
    else if (entry.endsWith('.json')) out.push(p);
  }
  return out;
}

const TRIGGER_ALIASES = {
  event: 'event_listener', event_bus: 'event_listener', event_sub: 'event_listener',
  event_subscription: 'event_listener', cron: 'schedule', scheduled: 'schedule',
  timer: 'schedule', poll: 'polling', hook: 'webhook', http: 'webhook',
};
const normTrigger = (t) => TRIGGER_ALIASES[t] ?? t;

/** Very rough role extractor: first sentence of the identity blob that looks
 * like "You are a/the X." — returns the noun phrase. Degrades to null. */
function extractRole(identity) {
  if (!identity || typeof identity !== 'string') return null;
  const first = identity.split(/\. |\n/)[0] ?? '';
  const m = first.match(/you are (?:a |an |the )?([^,;.]+)/i);
  return m ? m[1].trim().replace(/[.,]$/, '') : null;
}

/** One-line description from the first paragraph of the identity blob. */
function extractDescription(identity) {
  if (!identity || typeof identity !== 'string') return null;
  const paragraph = identity.split('\n\n')[0] ?? '';
  // Truncate to 220 chars at a sentence boundary.
  if (paragraph.length <= 220) return paragraph.trim();
  const cut = paragraph.slice(0, 220);
  const lastDot = cut.lastIndexOf('. ');
  return (lastDot > 60 ? cut.slice(0, lastDot + 1) : cut).trim();
}

/** Extract `persona` block from v2 `payload.structured_prompt` + flat fields. */
function buildPersona(payload) {
  const sp = payload.structured_prompt ?? {};
  const identityBlob = typeof sp.identity === 'string' ? sp.identity : '';
  const role = extractRole(identityBlob);
  const description = extractDescription(identityBlob);

  const operating = typeof sp.instructions === 'string' ? sp.instructions : '';
  const toolGuidance = typeof sp.toolGuidance === 'string' ? sp.toolGuidance : '';
  const errorHandling = typeof sp.errorHandling === 'string' ? sp.errorHandling : '';
  const examples = Array.isArray(sp.examples)
    ? sp.examples
    : (typeof sp.examples === 'string' && sp.examples.trim() ? [sp.examples] : []);

  const tools = Array.isArray(payload.suggested_tools)
    ? payload.suggested_tools.filter((t) => typeof t === 'string' || (t && t.name))
        .map((t) => (typeof t === 'string' ? t : t.name))
    : [];

  const connectors = Array.isArray(payload.suggested_connectors)
    ? payload.suggested_connectors.map((c) => {
        const { use_case_id, related_triggers, related_tools, ...rest } = c;
        return rest;
      })
    : [];

  // Global channels become persona defaults when they have no use_case_id tag.
  const globalChannels = Array.isArray(payload.suggested_notification_channels)
    ? payload.suggested_notification_channels.filter((ch) => !ch.use_case_id)
    : [];

  return {
    identity: {
      role: role ?? '# TODO: one-sentence role',
      description: description ?? payload.description ?? '# TODO: one-line description',
    },
    voice: {
      style: '# TODO: direct, calm, specific voice description',
      output_format: '# TODO: how outputs should be structured',
      tone_adjustments: [],
    },
    principles: ['# TODO: 2-5 cross-cutting principles'],
    constraints: ['# TODO: 2-5 hard limits'],
    decision_principles: [],
    verbosity_default: 'normal',
    operating_instructions: operating,
    tool_guidance: toolGuidance,
    error_handling: errorHandling,
    examples,
    tools,
    connectors,
    notification_channels_default: globalChannels.length > 0
      ? globalChannels.map(({ use_case_id, ...rest }) => rest)
      : [{ type: 'built-in', description: 'In-app notification inbox' }],
    core_memories: [],
  };
}

/** Build one v3 `use_cases[i]` entry from a v1 `use_case_flow` + attributed artefacts. */
function buildUseCase(flow, idx, payload) {
  const id = flow.id ?? `uc_${idx + 1}`;
  const title = flow.name ?? `Use case ${idx + 1}`;
  const description = flow.description ?? '';
  const capability_summary =
    flow.capability_summary ??
    (description.length > 120 ? description.slice(0, 120).replace(/\s+\S*$/, '') + '…' : description);

  // Trigger linkage: prefer explicit use_case_id match, else positional.
  const allTriggers = Array.isArray(payload.suggested_triggers) ? payload.suggested_triggers : [];
  let trigger = allTriggers.find((t) => t.use_case_id === id);
  if (!trigger && allTriggers.length === (payload.use_case_flows?.length ?? 0)) {
    trigger = allTriggers[idx];
  }
  const suggested_trigger = trigger
    ? {
        trigger_type: normTrigger(trigger.trigger_type ?? 'manual'),
        config: trigger.config ?? {},
        description: trigger.description ?? '',
      }
    : null;

  // Connector references: which connector names this capability uses.
  const allConnectors = Array.isArray(payload.suggested_connectors) ? payload.suggested_connectors : [];
  let connectorNames = [];
  const scoped = allConnectors.filter((c) => c.use_case_id === id);
  if (scoped.length > 0) {
    connectorNames = scoped.map((c) => c.name).filter(Boolean);
  } else if (allConnectors.length > 0 && (payload.use_case_flows?.length ?? 0) === 1) {
    connectorNames = allConnectors.map((c) => c.name).filter(Boolean);
  } else {
    // Parse connector names referenced in the flow's nodes.
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const fromNodes = new Set(
      nodes.map((n) => (n && typeof n === 'object' ? n.connector : null)).filter(Boolean),
    );
    connectorNames = [...fromNodes];
  }

  // Notification channels — per-capability when tagged, else inherit default.
  const allChannels = Array.isArray(payload.suggested_notification_channels)
    ? payload.suggested_notification_channels
    : [];
  const capChannels = allChannels
    .filter((ch) => ch.use_case_id === id)
    .map(({ use_case_id, ...rest }) => rest);

  // Event subscriptions — per-capability when tagged, flatten all global
  // ones onto single-capability templates.
  const allEvents = Array.isArray(payload.suggested_event_subscriptions)
    ? payload.suggested_event_subscriptions
    : [];
  const scopedEvents = allEvents.filter((e) => e.use_case_id === id);
  const eventSubs = scopedEvents.length > 0
    ? scopedEvents.map(({ use_case_id, ...rest }) => ({
        event_type: rest.event_type,
        direction: rest.direction ?? 'emit',
        description: rest.description ?? '',
      }))
    : (allEvents.length > 0 && (payload.use_case_flows?.length ?? 0) === 1)
    ? allEvents.map(({ use_case_id, ...rest }) => ({
        event_type: rest.event_type,
        direction: rest.direction ?? 'emit',
        description: rest.description ?? '',
      }))
    : [];

  // Derive review / memory policies from protocol_capabilities.
  const protoCaps = Array.isArray(payload.protocol_capabilities) ? payload.protocol_capabilities : [];
  const reviewEntry = protoCaps.find((c) => c.type === 'manual_review');
  const memoryEntry = protoCaps.find((c) => c.type === 'agent_memory');
  const review_policy = reviewEntry
    ? { mode: 'on_low_confidence', context: reviewEntry.context ?? reviewEntry.label ?? '' }
    : { mode: 'never', context: null };
  const memory_policy = memoryEntry
    ? { enabled: true, context: memoryEntry.context ?? memoryEntry.label ?? 'Memory enabled' }
    : { enabled: false, context: null };

  // input_schema: derive from v1 suggested_parameters when flow has none.
  const params = Array.isArray(payload.suggested_parameters) ? payload.suggested_parameters : [];
  const input_schema = params.map((p) => ({
    name: p.key ?? p.variable_name ?? 'value',
    type: p.type ?? 'text',
    default: p.default_value ?? p.value,
    min: p.min,
    max: p.max,
    description: p.description,
  })).filter((p) => p.name && p.name !== 'value');
  const sample_input = input_schema.reduce((acc, f) => {
    if (f.default !== undefined) acc[f.name] = f.default;
    return acc;
  }, {});

  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow.edges) ? flow.edges : [];

  return {
    id,
    title,
    description,
    capability_summary,
    category: flow.category ?? payload.category?.[0] ?? 'general',
    enabled_by_default: flow.enabled_by_default !== false,
    execution_mode: flow.execution_mode ?? 'e2e',
    model_override: null,
    suggested_trigger,
    connectors: connectorNames,
    notification_channels: capChannels,
    review_policy,
    memory_policy,
    event_subscriptions: eventSubs,
    error_handling: '',
    input_schema,
    sample_input,
    tool_hints: Array.isArray(flow.tool_hints) ? flow.tool_hints : [],
    test_fixtures: [],
    use_case_flow: { nodes, edges },
  };
}

/** Preserve adoption_questions and annotate with scope when heuristically inferable. */
function migrateAdoptionQuestions(payload, useCases) {
  const questions = Array.isArray(payload.adoption_questions) ? payload.adoption_questions : [];
  const capabilityIds = new Set(useCases.map((u) => u.id));
  return questions.map((q) => {
    const out = { ...q };
    if (!out.scope) {
      if (q.use_case_id && capabilityIds.has(q.use_case_id)) out.scope = 'capability';
      else if (Array.isArray(q.connector_names) && q.connector_names.length > 0) out.scope = 'connector';
      else out.scope = 'persona';
    }
    if (!out.maps_to && out.variable_name) {
      // Infer maps_to: persona-scope → persona.core_memories[]; capability → sample_input
      if (out.scope === 'capability' && out.use_case_id) {
        out.maps_to = `use_cases[${out.use_case_id}].sample_input.${out.variable_name}`;
      } else if (out.scope === 'persona') {
        // leave maps_to null; flow through as configuration section injection
      }
    }
    return out;
  });
}

function migrateTemplate(template) {
  if (template.schema_version === 3) return { changed: false, template };

  const original = JSON.parse(JSON.stringify(template));
  const payload = template.payload ?? {};
  const flows = Array.isArray(payload.use_case_flows) ? payload.use_case_flows : [];

  // If the template has no use_case_flows, synthesize a single "default" capability.
  const flowsEffective = flows.length > 0
    ? flows
    : [{
        id: 'uc_main',
        name: template.name ?? 'Main capability',
        description: template.description ?? '',
        nodes: [],
        edges: [],
      }];

  const persona = buildPersona(payload);
  const use_cases = flowsEffective.map((f, i) => buildUseCase(f, i, payload));
  const adoption_questions = migrateAdoptionQuestions(payload, use_cases);

  const v3Payload = {
    // Keep top-level catalog metadata carried by payload (service_flow, persona_meta)
    ...(payload.service_flow ? { service_flow: payload.service_flow } : {}),
    persona,
    use_cases,
    adoption_questions,
    ...(payload.persona_meta ? { persona_meta: payload.persona_meta } : {}),
  };

  const next = {
    ...template,
    schema_version: 3,
    payload: v3Payload,
  };

  // Remove top-level duplicates that now live in v3 structure.
  delete next.is_published_false_probe;

  const changed = JSON.stringify(original) !== JSON.stringify(next);
  return { changed, template: next, original };
}

// ── Run ────────────────────────────────────────────────────────────

const files = findJsonFiles(TEMPLATES_DIR).sort();
let migrated = 0;
let skipped = 0;
const flagged = [];

for (const file of files) {
  const rel = relative(TEMPLATES_DIR, file).replace(/\\/g, '/');
  if (ONLY && !rel.includes(ONLY)) continue;

  const raw = readFileSync(file, 'utf-8');
  let template;
  try {
    template = JSON.parse(raw);
  } catch (e) {
    console.error(`[parse error] ${rel}: ${e.message}`);
    continue;
  }

  const { changed, template: next } = migrateTemplate(template);
  if (!changed) {
    skipped++;
    if (VERBOSE) console.log(`  [skip]     ${rel}  (already v3)`);
    continue;
  }

  migrated++;
  const ucCount = next.payload.use_cases?.length ?? 0;
  const questCount = next.payload.adoption_questions?.length ?? 0;
  const warning = next.payload.persona.voice.style.startsWith('# TODO')
    ? '  [TODO voice]'
    : '';
  console.log(`  [migrate]  ${rel}  uc=${ucCount} q=${questCount}${warning}`);

  if (warning) flagged.push(rel);

  if (!DRY_RUN) {
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  }
}

console.log('');
console.log(`Migrated: ${migrated} · skipped (already v3): ${skipped}`);
console.log(`Templates flagged for hand-authoring persona content: ${flagged.length}`);
if (DRY_RUN) console.log('(dry run — no files written)');

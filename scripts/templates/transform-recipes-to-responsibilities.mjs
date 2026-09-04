#!/usr/bin/env node
/**
 * Stage B (agent-manifest rebase, WP4) — one-way transform of the recipe seed
 * bundle's payloads from "serialized use-case JSON" (v1) to "responsibility
 * charter JSON" (v2).
 *
 * WHAT IT REWRITES
 * `scripts/templates/_recipe_seeds.json` in place:
 *   - the bundle's `version` goes 1 -> 2 (the compiled-in reader,
 *     `src-tauri/src/engine/recipe_seed.rs`, pins `EXPECTED_SEED_VERSION` and
 *     must be bumped in the same change — the pin exists precisely so a
 *     payload-shape change cannot land silently);
 *   - every `recipes[].prompt_template` becomes the v2 charter shape below;
 *   - EVERY OTHER top-level seed field (`id`, `source_template_id`,
 *     `source_use_case_id`, `source_version`, `name`, `description`,
 *     `category`, `tags`, ...) is byte-identical, so the 111 templates'
 *     `recipe_ref` bindings (keyed by recipe row id + version) survive
 *     unchanged, and `sub_explore/recipeIndex.generated.json` (derived from
 *     top-level fields only) stays valid without regeneration.
 *
 * V2 PAYLOAD SHAPE (camelCase, mirrors CreatePersonaResponsibilityInput /
 * ResponsibilitySpec in src/lib/bindings):
 *   {
 *     id,                    // the legacy use case's id (uc_*)
 *     title,
 *     domain,                // from the UC's `category`
 *     outcomes: [],
 *     procedure,             // capability_summary first, description appended
 *     connectors: [...],     // from UC `connectors` (slug strings), else []
 *     cadence,               // best-effort hint from suggested_trigger:
 *                            //   { attentionEnabled: false, intervalMinutes? }
 *                            //   attention stays OFF (WP5 ships the loop)
 *     approvalGates: [],
 *     spec: {                // the runtime envelope
 *       inputSchema, sampleInput, modelOverride, engineMode (execution_mode),
 *       notificationChannels (type names), eventSubscriptions, timeFilter,
 *       testFixtures, sourceRecipeId (seed row id), sourceRecipeVersion,
 *       memoryPolicy, suggestedTrigger,
 *       // preserved keys with no typed ResponsibilitySpec slot yet — kept in
 *       // the JSON so nothing recipe authors wrote is lost; the Rust struct
 *       // ignores them until slots exist (see the WP4 report):
 *       errorHandling (prose), reviewPolicy, generationSettings,
 *       modelRationale, toolHints, useCaseFlow, enabledByDefault
 *     }
 *   }
 *
 * WHY spec.errorHandling AND NOT spec.errorPolicy: `error_handling` is free
 * prose in 299/299 seeds (measured at transform time; the script asserts it).
 * The typed `errorPolicy` shape ({incident, lab, escalateAfter}) cannot be
 * derived from prose deterministically, and guessing booleans out of prose is
 * exactly the kind of fabrication a transform must refuse. When a payload DOES
 * carry a structured `error_policy` object (none do today), it maps through.
 *
 * REFUSALS (loud, exit 1): a bundle that is not version 1, a payload that does
 * not parse as JSON, a payload already v2-shaped (has `procedure` — rerunning
 * on transformed output must fail, not double-transform), or a payload missing
 * `id`/`title`. Any refusal aborts before writing a single byte.
 *
 * Ends with a count report; 299/299 expected.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SEEDS_PATH = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');

const failures = [];
const fail = (msg) => failures.push(msg);

const raw = fs.readFileSync(SEEDS_PATH, 'utf8');
const bundle = JSON.parse(raw);

if (bundle.version !== 1) {
  console.error(
    `REFUSED: bundle version is ${bundle.version}, expected 1. ` +
      'A version-2 bundle is already transformed; running the transform twice would corrupt it.',
  );
  process.exit(1);
}
if (!Array.isArray(bundle.recipes) || bundle.recipes.length === 0) {
  console.error('REFUSED: bundle has no recipes[] array.');
  process.exit(1);
}

/** Non-empty trimmed string, else undefined. */
const str = (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);
/** Keep a value only when it is a non-empty array. */
const arr = (v) => (Array.isArray(v) && v.length > 0 ? v : undefined);
/** Keep a value only when it is a non-null object (arrays excluded). */
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);

/**
 * Best-effort cadence hint from a suggested_trigger. Attention stays OFF —
 * seeding a charter must not silently enrol a persona in the attention loop
 * (WP1's posture; the loop itself ships in WP5). `intervalMinutes` is derived
 * only from cron patterns whose meaning is unambiguous:
 *   "each-N-minutes" -> N          (minute field matches every-N)
 *   "M * * * *"      -> 60         (hourly)
 *   "M H * * *"      -> 1440       (daily)
 *   "M H * * D"      -> 10080      (weekly)
 * Anything else (webhook, manual, event, build_hook, exotic cron) carries no
 * interval — the full trigger survives verbatim at spec.suggestedTrigger.
 */
function deriveCadence(suggestedTrigger) {
  const cadence = { attentionEnabled: false };
  const t = obj(suggestedTrigger);
  if (!t) return cadence;
  const kind = str(t.trigger_type);
  if (kind !== 'schedule' && kind !== 'polling') return cadence;
  const cron = str(obj(t.config)?.cron);
  if (!cron) return cadence;
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cadence;
  const [min, hour, dom, mon, dow] = parts;
  const everyN = /^\*\/(\d+)$/.exec(min);
  if (everyN && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    cadence.intervalMinutes = Number(everyN[1]);
  } else if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    cadence.intervalMinutes = 60;
  } else if (/^\d+$/.test(min) && /^\d+(,\d+)*$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    cadence.intervalMinutes = 1440;
  } else if (/^\d+$/.test(min) && /^\d+(,\d+)*$/.test(hour) && dom === '*' && mon === '*' && /^\d+(,\d+)*$/.test(dow)) {
    cadence.intervalMinutes = 10080;
  }
  return cadence;
}

/** notification_channels: [{type, description}] | [string] -> type names. */
function channelTypes(channels) {
  const a = arr(channels);
  if (!a) return undefined;
  const types = a
    .map((c) => (typeof c === 'string' ? c : str(obj(c)?.type)))
    .filter((t) => typeof t === 'string' && t.length > 0);
  return types.length > 0 ? types : undefined;
}

/** connectors: [string] (v1 seeds) | [{name}] (defensive) -> slug strings. */
function connectorSlugs(connectors) {
  const a = arr(connectors);
  if (!a) return [];
  return a
    .map((c) => (typeof c === 'string' ? c.trim() : str(obj(c)?.name) ?? ''))
    .filter((s) => s.length > 0);
}

/** Structured error policy ({incident, lab, escalate_after}) if the payload
 *  carries one as an object; prose stays prose (spec.errorHandling). */
function structuredErrorPolicy(errorPolicy) {
  const o = obj(errorPolicy);
  if (!o) return undefined;
  const out = {};
  if (typeof o.incident === 'boolean') out.incident = o.incident;
  if (typeof o.lab === 'boolean') out.lab = o.lab;
  const after = o.escalate_after ?? o.escalateAfter;
  if (typeof after === 'number' && Number.isFinite(after)) out.escalateAfter = after;
  return Object.keys(out).length > 0 ? out : undefined;
}

function transformOne(seed, index) {
  let uc;
  try {
    uc = JSON.parse(seed.prompt_template);
  } catch (e) {
    fail(`recipes[${index}] (${seed.id}): prompt_template is not valid JSON: ${e.message}`);
    return null;
  }
  if (!obj(uc)) {
    fail(`recipes[${index}] (${seed.id}): prompt_template is not a JSON object`);
    return null;
  }
  if (typeof uc.procedure === 'string' || obj(uc.spec)) {
    fail(
      `recipes[${index}] (${seed.id}): payload is already v2 (has procedure/spec) — ` +
        'refusing to double-transform',
    );
    return null;
  }
  const id = str(uc.id);
  const title = str(uc.title);
  if (!id || !title) {
    fail(`recipes[${index}] (${seed.id}): payload is missing id/title`);
    return null;
  }

  const summary = str(uc.capability_summary);
  const description = str(uc.description);
  const procedure = [summary, description].filter(Boolean).join('\n\n');
  if (!procedure) {
    fail(`recipes[${index}] (${seed.id}): payload has neither capability_summary nor description`);
    return null;
  }

  const spec = {};
  const put = (key, value) => {
    if (value !== undefined && value !== null) spec[key] = value;
  };
  put('inputSchema', arr(uc.input_schema));
  put('sampleInput', obj(uc.sample_input) ?? arr(uc.sample_input));
  put('modelOverride', str(uc.model_override));
  put('engineMode', str(uc.execution_mode));
  put('notificationChannels', channelTypes(uc.notification_channels));
  put('eventSubscriptions', arr(uc.event_subscriptions));
  put('errorPolicy', structuredErrorPolicy(uc.error_policy));
  put('timeFilter', obj(uc.time_filter));
  put('testFixtures', arr(uc.test_fixtures));
  put('sourceRecipeId', seed.id);
  put('sourceRecipeVersion', str(seed.source_version) ?? '1.0.0');
  put('memoryPolicy', obj(uc.memory_policy));
  put('suggestedTrigger', obj(uc.suggested_trigger));
  // Preserved without a typed ResponsibilitySpec slot (see header).
  put('errorHandling', str(uc.error_handling));
  put('reviewPolicy', obj(uc.review_policy));
  put('generationSettings', obj(uc.generation_settings));
  put('modelRationale', str(uc.model_rationale));
  put('toolHints', arr(uc.tool_hints));
  put('useCaseFlow', obj(uc.use_case_flow));
  if (typeof uc.enabled_by_default === 'boolean') spec.enabledByDefault = uc.enabled_by_default;

  return {
    id,
    title,
    domain: str(uc.category) ?? 'general',
    outcomes: [],
    procedure,
    connectors: connectorSlugs(uc.connectors),
    cadence: deriveCadence(uc.suggested_trigger),
    approvalGates: [],
    spec,
  };
}

const transformed = [];
for (let i = 0; i < bundle.recipes.length; i++) {
  const seed = bundle.recipes[i];
  const v2 = transformOne(seed, i);
  if (v2 !== null) transformed.push({ seed, v2 });
}

if (failures.length > 0) {
  console.error(`REFUSED: ${failures.length} seed(s) failed the transform — nothing was written.`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// All-or-nothing write: only reached when every payload transformed.
for (const { seed, v2 } of transformed) {
  seed.prompt_template = JSON.stringify(v2);
}
bundle.version = 2;
fs.writeFileSync(SEEDS_PATH, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

const withInterval = transformed.filter(({ v2 }) => v2.cadence.intervalMinutes !== undefined).length;
const withConnectors = transformed.filter(({ v2 }) => v2.connectors.length > 0).length;
const withStructuredError = transformed.filter(({ v2 }) => v2.spec.errorPolicy !== undefined).length;
console.log(
  `Transformed ${transformed.length}/${bundle.recipes.length} recipe payloads to responsibility shape v2 ` +
    `(bundle version 1 -> 2).`,
);
console.log(
  `  cadence intervalMinutes derived: ${withInterval} · connectors carried: ${withConnectors} · ` +
    `structured errorPolicy found: ${withStructuredError} (prose error_handling preserved at spec.errorHandling)`,
);

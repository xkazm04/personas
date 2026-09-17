/**
 * Stage E.3 — adapter from the backend `RecipeDefinition` (the row shape
 * Stage B's catalog persists) to the frontend `Recipe` (the rich,
 * connector-aware shape the Recipes catalog UI was built around).
 *
 * The two shapes diverged for good reason: the frontend type was written
 * top-down for the recipe-redesign UX (typed bindings, connector
 * eligibility, generation settings); the backend grew bottom-up out of
 * Stage B's "package every template UC as a row in `recipe_definitions`"
 * migration. Bridging them in one direction lets the existing browse /
 * detail / adoption components consume real data without rewriting any
 * of them.
 *
 * Field mapping:
 * - `id`, `name`, `description` → straight pass-through.
 * - `prompt_template` (the serialized UC JSON, set by Stage B Phase 1b's
 *   derive) → parsed once and used to populate `template.toolHints`,
 *   `template.suggestedTrigger`, `template.notificationChannelTypes`,
 *   plus the connector slugs in `requiredConnectors`.
 * - `category` (Option<String>) → coerced into the strict
 *   `RecipeCategory` union; nulls and unrecognised values default to
 *   `'automation'` (the broadest bucket).
 * - `bindings` → derived from the payload's input schema
 *   (`inputSchema` in a v3 `RecipeSpec`, `input_schema` in the pre-v3
 *   use-case shape — both are accepted, the catalog holds rows of both
 *   vintages). Each declared field becomes one `RecipeBinding` whose
 *   `kind` mirrors the declared type, so the adoption modal collects the
 *   settings the recipe author wrote down instead of writing
 *   `{{placeholders}}` into the persona verbatim.
 * - `tags` → JSON-decoded; tolerant of malformed entries.
 *
 * Defensive throughout: a malformed prompt_template, missing field, or
 * unexpected shape never throws — we degrade gracefully to the most
 * conservative defaults so a single bad recipe can't blow up the
 * catalog grid.
 */
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { NotificationChannelType } from '@/lib/types/frontendTypes';
import type { BindingKind, BindingValue, Recipe, RecipeBinding, RecipeCategory } from '../types';

const KNOWN_CATEGORIES: ReadonlySet<RecipeCategory> = new Set<RecipeCategory>([
  'monitoring',
  'reporting',
  'automation',
  'communication',
  'data-sync',
  'analysis',
  'development',
  'content',
  'productivity',
]);

/** Alias → canonical bucket. Built from the actual category vocabulary of
 *  the 298 seeded recipes' use-case JSON (42 distinct values), so the
 *  catalog's category column reflects what each recipe really does instead
 *  of collapsing everything into 'automation'. */
const CATEGORY_ALIASES: Readonly<Record<string, RecipeCategory>> = {
  // monitoring — watching state, alerting on change
  monitor: 'monitoring', observability: 'monitoring', tracking: 'monitoring',
  realtime: 'monitoring', security: 'monitoring',
  // reporting — digests, summaries, dashboards
  reports: 'reporting', audit: 'reporting', 'audit-reporting': 'reporting',
  analytics: 'reporting',
  // automation — scheduled/operational work without a better home
  workflow: 'automation', operations: 'automation', maintenance: 'automation',
  scheduled: 'automation', configuration: 'automation', response: 'automation',
  // communication — messages out to people
  messaging: 'communication', notify: 'communication', notifications: 'communication',
  outreach: 'communication', email_processing: 'communication',
  // data-sync — moving/ingesting/archiving data between systems
  data: 'data-sync', sync: 'data-sync', integration: 'data-sync',
  ingestion: 'data-sync', collections: 'data-sync', archive: 'data-sync',
  // analysis — research, review, investigation
  research: 'analysis', investigation: 'analysis', extraction: 'analysis',
  discovery: 'analysis', review: 'analysis', strategy: 'analysis',
  // development — code, builds, engineering workflows
  build: 'development',
  // content — writing, editing, publishing
  writing: 'content', editing: 'content', publishing: 'content',
  curation: 'content', generation: 'content',
  // productivity — personal/team support, planning, people ops
  personal_productivity: 'productivity', support: 'productivity',
  hr: 'productivity', recruiting_ops: 'productivity', planning: 'productivity',
  growth: 'productivity', intake: 'productivity',
};

function coerceCategory(value: string | null | undefined): RecipeCategory {
  if (!value) return 'automation';
  const lower = value.toLowerCase().trim();
  if (KNOWN_CATEGORIES.has(lower as RecipeCategory)) {
    return lower as RecipeCategory;
  }
  return CATEGORY_ALIASES[lower] ?? 'automation';
}

function safeJsonArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asStringArray(arr: unknown[]): string[] {
  return arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

interface ParsedUseCase {
  /** Human display title from the UC JSON — the fix for catalog rows that
   *  otherwise show the technical `uc_*` id as their name. */
  title?: string;
  /** UC-level category — far more specific than the row-level
   *  `RecipeDefinition.category`, which is null for ~97% of seeds. */
  category?: string;
  /** One-line capability summary — better browse tagline than a hard
   *  80-char slice of the long description. */
  capabilitySummary?: string;
  toolHints: string[];
  connectors: string[];
  suggestedTrigger?: {
    type: 'schedule' | 'polling' | 'webhook' | 'manual';
    cron?: string;
    description: string;
  };
  notificationChannelTypes: NotificationChannelType[];
  generationSettings?: {
    memories?: 'on' | 'off';
    reviews?: 'on' | 'off' | 'trust_llm';
    events?: 'on' | 'off';
  };
  reviewPolicy?: { mode?: string; context?: string };
  memoryPolicy?: { enabled?: boolean; context?: string };
  errorHandling?: string;
  eventSubscriptions?: Array<{ eventType: string; direction: 'listen' | 'emit'; description?: string }>;
  inputParameters?: Array<{ name: string; type?: string; defaultValue?: string; description?: string }>;
  /** The same declared fields, typed as adoption-form bindings. Empty when
   *  the payload declares no schema. */
  bindings: RecipeBinding[];
  promptTemplate: string;
}

/** Render a schema default for display: primitives as-is, structures as JSON. */
function defaultValueLabel(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v.length > 0 ? v : undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return undefined; }
}

function parseEventSubscriptions(uc: Record<string, unknown>): ParsedUseCase['eventSubscriptions'] {
  if (!Array.isArray(uc.event_subscriptions)) return undefined;
  const events = (uc.event_subscriptions as unknown[])
    .map((e) => {
      if (!e || typeof e !== 'object') return null;
      const rec = e as Record<string, unknown>;
      const eventType = nonEmptyString(rec.event_type);
      const direction: 'listen' | 'emit' | null =
        rec.direction === 'emit' ? 'emit' : rec.direction === 'listen' ? 'listen' : null;
      if (!eventType || !direction) return null;
      return { eventType, direction, description: nonEmptyString(rec.description) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  return events.length > 0 ? events : undefined;
}

/** The declared input-field array off a parsed recipe payload.
 *
 *  A v3 `RecipeSpec` serializes it as `inputSchema` (the Rust structs carry
 *  `#[serde(rename_all = "camelCase")]`); the pre-v3 use-case shape wrote
 *  `input_schema`. The catalog holds rows of both vintages, so read both —
 *  keying off one spelling alone silently returns nothing for the other half
 *  of the table. Never throws: a non-array value reads as "no fields". */
function rawInputSchema(uc: Record<string, unknown>): unknown[] {
  const raw = uc.inputSchema ?? uc.input_schema;
  return Array.isArray(raw) ? raw : [];
}

function parseInputParameters(uc: Record<string, unknown>): ParsedUseCase['inputParameters'] {
  const params = rawInputSchema(uc)
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const rec = p as Record<string, unknown>;
      const name = nonEmptyString(rec.name);
      if (!name) return null;
      return {
        name,
        type: nonEmptyString(rec.type),
        defaultValue: defaultValueLabel(rec.default),
        description: nonEmptyString(rec.description),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  return params.length > 0 ? params : undefined;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/** `snake_case_name` / `camelCaseName` → `Snake case name`.
 *
 *  A display fallback for a field that declares no `label` of its own. It is
 *  cosmetic by construction — nothing reads the produced string back, and no
 *  other surface's spelling of the same field name depends on it — so this is
 *  deliberately NOT a mirror of any other humanizer and owes none of them
 *  agreement. */
function humanizeParamName(name: string): string {
  const spaced = name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Choice list for a declared field. Recipe payloads use `options`; a few
 *  v3 rows use JSON-Schema's `enum` for the same thing. Accepts plain
 *  strings and `{value,label}` objects; returns `undefined` (not `[]`) when
 *  there is no usable list, so the caller falls back to a free-text kind
 *  rather than rendering an empty dropdown. */
function parseBindingOptions(rec: Record<string, unknown>): Array<{ value: string; label: string }> | undefined {
  const raw = Array.isArray(rec.options)
    ? (rec.options as unknown[])
    : Array.isArray(rec.enum)
      ? (rec.enum as unknown[])
      : null;
  if (!raw) return undefined;
  const opts = raw
    .map((o) => {
      if (typeof o === 'string' || typeof o === 'number' || typeof o === 'boolean') {
        const value = String(o);
        return value.length > 0 ? { value, label: value } : null;
      }
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        const value = nonEmptyString(r.value) ?? nonEmptyString(r.name);
        if (!value) return null;
        return { value, label: nonEmptyString(r.label) ?? value };
      }
      return null;
    })
    .filter((o): o is { value: string; label: string } => o !== null);
  return opts.length > 0 ? opts : undefined;
}

function finiteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Declared field type → the form control the adoption modal renders.
 *
 *  A declared choice list WINS over the type token: the seeded catalog has
 *  `type: "string"` fields carrying an `enum`, and rendering those as free
 *  text would let the user type a value the recipe cannot act on. */
function bindingKindFor(rec: Record<string, unknown>, declaredType: string): BindingKind {
  const options = parseBindingOptions(rec);
  if (options) {
    return declaredType === 'multi_select' || declaredType === 'multiselect'
      ? { type: 'enum', options, multi: true }
      : { type: 'enum', options };
  }
  switch (declaredType) {
    case 'number':
    case 'integer':
      return { type: 'number', min: finiteNumber(rec.min), max: finiteNumber(rec.max) };
    case 'boolean':
      return { type: 'boolean' };
    case 'cron':
    case 'schedule':
      return { type: 'cron' };
    case 'textarea':
      return { type: 'text', multiline: true };
    default:
      return { type: 'text', multiline: rec.ui_component === 'TextArea' };
  }
}

/** Coerce the schema's declared default into a value the derived kind's
 *  control can actually hold. A default that does not fit (a string default
 *  on a number field, an enum default that is not one of the options) is
 *  DROPPED rather than coerced into something the user never declared —
 *  `defaultBindingValues` then simply leaves that field empty. */
function bindingDefaultFor(kind: BindingKind, raw: unknown): BindingValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  switch (kind.type) {
    case 'number':
      return finiteNumber(raw);
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'enum': {
      const allowed = new Set(kind.options.map((o) => o.value));
      if (kind.multi) {
        const arr = Array.isArray(raw) ? raw : [raw];
        const picked = arr
          .filter((v): v is string | number | boolean => typeof v !== 'object' && v !== undefined && v !== null)
          .map(String)
          .filter((v) => allowed.has(v));
        return picked.length > 0 ? picked : undefined;
      }
      if (typeof raw === 'object') return undefined;
      const v = String(raw);
      return allowed.has(v) ? v : undefined;
    }
    default:
      return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }
}

/** Project the payload's declared input fields onto the adoption form's
 *  binding manifest.
 *
 *  Requiredness comes ONLY from the schema's own `required: true`. A field
 *  that does not declare it stays optional, so deriving bindings never turns
 *  a one-click adopt into a blocked form for a knob the author never marked
 *  as needed.
 *
 *  A field whose name is not a bare `\w+` word is skipped: `substituteString`
 *  matches `{{(\w+)}}`, so such a binding could never be substituted into the
 *  template and would be a dead form field. Duplicates keep the first
 *  declaration — two controls writing the same `values` key is worse than
 *  one. */
function bindingsFromInputSchema(uc: Record<string, unknown>): RecipeBinding[] {
  const out: RecipeBinding[] = [];
  const seen = new Set<string>();
  for (const entry of rawInputSchema(uc)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const name = nonEmptyString(rec.name) ?? nonEmptyString(rec.key);
    if (!name || !/^\w+$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    const declaredType = (nonEmptyString(rec.type) ?? 'text').toLowerCase();
    const kind = bindingKindFor(rec, declaredType);
    out.push({
      variable: name,
      label: nonEmptyString(rec.label) ?? humanizeParamName(name),
      description: nonEmptyString(rec.description) ?? '',
      kind,
      required: rec.required === true,
      default: bindingDefaultFor(kind, rec.default),
    });
  }
  return out;
}

/** Collapse the UC review-mode vocabulary (always / never / on_low_confidence /
 *  auto_triage / …) into the 3-state toggle the adoption flow knows.
 *
 *  This MUST mirror the backend's `review_policy.mode` -> runtime mapping
 *  (`dispatch::pick_generation_policy`), because the value we return is written
 *  into `generation_settings.reviews`, which the backend gives PRECEDENCE over
 *  `review_policy.mode`. There is no path in the backend from a review-mode to
 *  `TrustLlm` — so a review-mode must never produce `'trust_llm'` here either.
 *
 *  The shipped catch-all did the opposite: any mode that wasn't never/off/always
 *  fell to `'trust_llm'` (auto-resolve, never queue a human). So `on_low_confidence`
 *  — which the builder path correctly maps to `On` (review) and which the user
 *  reads as "pause when unsure" — silently became "never review" on the adoption
 *  path, while the guardrails card labelled it "Conditional" (UAT 2026-07-20,
 *  support-lead). Two identically-worded options, opposite safety behaviour.
 *
 *  Fail SAFE: an unrecognised mode means review, never skip-the-human. Only the
 *  genuine auto-resolve modes (`auto_triage`, explicit `trust_llm`) land in the
 *  no-human-queue bucket. There is no confidence signal in the product, so
 *  `on_low_confidence` can only conservatively mean "review". */
function reviewModeToSetting(mode: string | undefined): 'on' | 'off' | 'trust_llm' | undefined {
  if (!mode) return undefined;
  const m = mode.toLowerCase();
  if (m === 'never' || m === 'off') return 'off';
  // auto_triage and an explicit trust_llm are the only modes that legitimately
  // resolve without a human queue; everything else (always, on_low_confidence,
  // conditional, and any unknown mode) resolves to review.
  if (m === 'auto_triage' || m === 'autotriage' || m === 'auto-triage') return 'trust_llm';
  if (m === 'trust_llm' || m === 'trustllm' || m === 'trust-llm') return 'trust_llm';
  return 'on';
}

function parsePromptTemplate(prompt: string): ParsedUseCase {
  // Default empty result that callers can use when the parse fails.
  const empty: ParsedUseCase = {
    toolHints: [],
    connectors: [],
    notificationChannelTypes: [],
    bindings: [],
    promptTemplate: prompt,
  };
  if (!prompt) return empty;
  let uc: Record<string, unknown>;
  try {
    const parsed = JSON.parse(prompt);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    uc = parsed as Record<string, unknown>;
  } catch {
    return empty;
  }

  const toolHints = Array.isArray(uc.tool_hints) ? asStringArray(uc.tool_hints) : [];
  // `connectors` in a UC may be either a string array (slugs) or an array
  // of objects with a `name` field. Accept both shapes.
  const rawConnectors = Array.isArray(uc.connectors) ? (uc.connectors as unknown[]) : [];
  const connectors: string[] = rawConnectors
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object' && 'name' in c && typeof (c as { name: unknown }).name === 'string') {
        return (c as { name: string }).name;
      }
      return '';
    })
    .filter((s) => s.length > 0);

  let suggestedTrigger: ParsedUseCase['suggestedTrigger'] | undefined;
  if (uc.suggested_trigger && typeof uc.suggested_trigger === 'object') {
    const st = uc.suggested_trigger as Record<string, unknown>;
    const triggerType = typeof st.trigger_type === 'string' ? st.trigger_type : 'manual';
    const description = typeof st.description === 'string' ? st.description : '';
    const cfg = (st.config && typeof st.config === 'object') ? (st.config as Record<string, unknown>) : {};
    const cron = typeof cfg.cron === 'string' ? cfg.cron : undefined;
    // Coerce the recipe's wider trigger taxonomy into the frontend's
    // narrower one. Anything not in the union falls into 'manual'.
    const narrow: 'schedule' | 'polling' | 'webhook' | 'manual' =
      triggerType === 'schedule' || triggerType === 'polling' ||
      triggerType === 'webhook' || triggerType === 'manual'
        ? triggerType
        : (triggerType === 'event_listener' ? 'webhook' : 'manual');
    suggestedTrigger = { type: narrow, cron, description };
  }

  const rawChannels = Array.isArray(uc.notification_channels) ? uc.notification_channels : [];
  // Frontend's NotificationChannelType is narrow ("slack" | "telegram" |
  // "email"); recipes may carry richer channel kinds ("built-in",
  // "discord", "webhook", etc.) that the runtime hasn't surfaced to the
  // type system yet. Forward only the recognized subset.
  const notificationChannelTypes: NotificationChannelType[] = rawChannels
    .map((c) => {
      if (c && typeof c === 'object' && 'type' in c) {
        return (c as { type: unknown }).type;
      }
      return null;
    })
    .filter((t): t is string => typeof t === 'string')
    .filter((t): t is NotificationChannelType =>
      t === 'slack' || t === 'telegram' || t === 'email',
    );

  let reviewPolicy: ParsedUseCase['reviewPolicy'];
  if (uc.review_policy && typeof uc.review_policy === 'object') {
    const rp = uc.review_policy as Record<string, unknown>;
    reviewPolicy = { mode: nonEmptyString(rp.mode), context: nonEmptyString(rp.context) };
  }
  let memoryPolicy: ParsedUseCase['memoryPolicy'];
  if (uc.memory_policy && typeof uc.memory_policy === 'object') {
    const mp = uc.memory_policy as Record<string, unknown>;
    memoryPolicy = {
      enabled: typeof mp.enabled === 'boolean' ? mp.enabled : undefined,
      context: nonEmptyString(mp.context),
    };
  }

  // Derive the 3-state adoption toggles from the real policies so the
  // detail view reflects what the recipe actually does instead of
  // hardcoded ON defaults.
  const reviews = reviewModeToSetting(reviewPolicy?.mode);
  const memories = memoryPolicy?.enabled === undefined
    ? undefined
    : (memoryPolicy.enabled ? 'on' as const : 'off' as const);
  const generationSettings = reviews || memories
    ? { reviews, memories }
    : undefined;

  return {
    title: nonEmptyString(uc.title),
    category: nonEmptyString(uc.category),
    capabilitySummary: nonEmptyString(uc.capability_summary),
    toolHints,
    connectors,
    suggestedTrigger,
    notificationChannelTypes,
    generationSettings,
    reviewPolicy,
    memoryPolicy,
    errorHandling: nonEmptyString(uc.error_handling),
    eventSubscriptions: parseEventSubscriptions(uc),
    inputParameters: parseInputParameters(uc),
    bindings: bindingsFromInputSchema(uc),
    promptTemplate: prompt,
  };
}

/**
 * Adapt a single backend `RecipeDefinition` into the frontend `Recipe`
 * shape. Always returns a valid Recipe — defaults fill in whatever the
 * source row leaves undefined.
 */
export function recipeDefinitionToRecipe(def: RecipeDefinition): Recipe {
  const parsed = parsePromptTemplate(def.prompt_template);
  const tags = asStringArray(safeJsonArray(def.tags));
  // Prefer the UC's human title over the row name — Stage B's derivation
  // wrote the technical `uc_*` id into `name` (the UC JSON has `title`,
  // not `name`), so for seeded rows the row name is not display-worthy.
  const name = parsed.title ?? def.name;
  const summary = parsed.capabilitySummary?.slice(0, 80)
    ?? ((def.description ?? '').trim().slice(0, 80) || name);
  const slug = slugify(name) || def.id.slice(0, 8);

  return {
    id: def.id,
    slug,
    name,
    summary,
    description: def.description ?? '',
    // UC-level category wins: row-level `category` is null for ~97% of
    // seeds, which used to collapse the whole catalog into 'automation'.
    category: coerceCategory(parsed.category ?? def.category),

    // No connector requirements declared → empty arrays. The frontend's
    // eligibility resolver treats empty `requiredConnectors` as
    // vacuously eligible, which is the correct behavior for recipes that
    // don't actually need any external wiring.
    requiredConnectors: parsed.connectors,
    optionalConnectors: [],

    template: {
      title: name,
      description: def.description ?? '',
      capabilitySummary: parsed.capabilitySummary ?? def.description ?? '',
      category: parsed.category ?? def.category ?? 'automation',
      suggestedTrigger: parsed.suggestedTrigger,
      toolHints: parsed.toolHints,
      notificationChannelTypes: parsed.notificationChannelTypes,
      generationSettings: parsed.generationSettings,
      reviewPolicy: parsed.reviewPolicy,
      memoryPolicy: parsed.memoryPolicy,
      errorHandling: parsed.errorHandling,
      eventSubscriptions: parsed.eventSubscriptions,
      inputParameters: parsed.inputParameters,
      promptTemplate: parsed.promptTemplate,
    },
    // Every field the payload's input schema declares becomes one form
    // control in `RecipeAdoptionModal`, so adoption collects the recipe's
    // own settings instead of leaving `{{placeholders}}` unsubstituted.
    bindings: parsed.bindings,

    // Catalog-seeded rows aren't flagged is_builtin in the DB (the seeder's
    // CreateRecipeInput has no such field) — but every derived recipe carries
    // source_template_id, and for all of them `created_at` is a synthetic
    // insert/derivation time, not a real publication date. Treat them as
    // builtin so display rules (e.g. hiding "Published · 1m ago") hold.
    isBuiltin: def.is_builtin || def.source_template_id != null,
    version: def.source_version ?? '1.0.0',
    publishedAt: def.created_at,
    author: 'Personas Team',
    tags,
    iconConnector: parsed.connectors[0],
  };
}

/** Batch adapt — convenience for `list_recipes()` callers. */
export function recipeDefinitionsToRecipes(defs: RecipeDefinition[]): Recipe[] {
  return defs.map(recipeDefinitionToRecipe);
}

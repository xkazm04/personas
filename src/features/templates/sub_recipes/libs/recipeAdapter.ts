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
 * - `bindings` → empty Vec. Phase 1b leaves recipe bindings unpopulated;
 *   when authors start declaring them, this adapter will pick them up
 *   from `recipe.input_schema` (the natural place for binding manifests
 *   to live in the Rust shape).
 * - `tags` → JSON-decoded; tolerant of malformed entries.
 *
 * Defensive throughout: a malformed prompt_template, missing field, or
 * unexpected shape never throws — we degrade gracefully to the most
 * conservative defaults so a single bad recipe can't blow up the
 * catalog grid.
 */
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { NotificationChannelType } from '@/lib/types/frontendTypes';
import type { Recipe, RecipeCategory } from '../types';

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
  promptTemplate: string;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function parsePromptTemplate(prompt: string): ParsedUseCase {
  // Default empty result that callers can use when the parse fails.
  const empty: ParsedUseCase = {
    toolHints: [],
    connectors: [],
    notificationChannelTypes: [],
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

  return {
    title: nonEmptyString(uc.title),
    category: nonEmptyString(uc.category),
    capabilitySummary: nonEmptyString(uc.capability_summary),
    toolHints,
    connectors,
    suggestedTrigger,
    notificationChannelTypes,
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
      promptTemplate: parsed.promptTemplate,
    },
    bindings: [],

    isBuiltin: def.is_builtin,
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

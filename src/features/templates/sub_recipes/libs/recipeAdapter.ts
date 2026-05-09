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
]);

function coerceCategory(value: string | null | undefined): RecipeCategory {
  if (!value) return 'automation';
  const lower = value.toLowerCase().trim();
  if (KNOWN_CATEGORIES.has(lower as RecipeCategory)) {
    return lower as RecipeCategory;
  }
  // Common aliases observed in the seeded catalog.
  if (lower === 'workflow' || lower === 'sync') return 'automation';
  if (lower === 'reports' || lower === 'audit' || lower === 'audit-reporting') return 'reporting';
  if (lower === 'observability' || lower === 'monitor') return 'monitoring';
  if (lower === 'messaging' || lower === 'notify') return 'communication';
  if (lower === 'data' || lower === 'integration') return 'data-sync';
  if (lower === 'research' || lower === 'investigation' || lower === 'extraction') return 'analysis';
  return 'automation';
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
  const summary = (def.description ?? '').trim().slice(0, 80) || def.name;
  const slug = slugify(def.name) || def.id.slice(0, 8);

  return {
    id: def.id,
    slug,
    name: def.name,
    summary,
    description: def.description ?? '',
    category: coerceCategory(def.category),

    // No connector requirements declared → empty arrays. The frontend's
    // eligibility resolver treats empty `requiredConnectors` as
    // vacuously eligible, which is the correct behavior for recipes that
    // don't actually need any external wiring.
    requiredConnectors: parsed.connectors,
    optionalConnectors: [],

    template: {
      title: def.name,
      description: def.description ?? '',
      capabilitySummary: def.description ?? '',
      category: def.category ?? 'automation',
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

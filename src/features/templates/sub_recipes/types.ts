/**
 * Recipe types — Phase 2a foundation.
 *
 * A Recipe is a curated, tool-specific, shareable form of a Persona Use
 * Case. It is **stateless** with respect to any particular persona: it
 * declares what it needs (connectors, credentials, variable bindings) and
 * what it becomes (a use-case template). Adoption resolves the bindings
 * against a target persona's wired tools and produces a real
 * `DesignUseCase` in that persona's `design_context`.
 *
 * This file is intentionally TS-only: no Rust schema, no migrations. The
 * old `recipe_definitions` table from the legacy LLM-template subsystem
 * is being thrown out wholesale; the future Rust schema (when we wire
 * persistence) will be derived from this contract, not the reverse.
 *
 * Storage in the prototype: a hand-authored array in `mockRecipes.ts`.
 */

import type { NotificationChannelType } from '@/lib/types/frontendTypes';

/** Coarse top-level taxonomy used for filter chips in the catalog. Avoid
 *  proliferation — when in doubt, choose the closest existing bucket.
 *  The 2026-06 extension (development / content / productivity) tracks the
 *  real distribution of the 298 seeded recipes — those three buckets alone
 *  cover ~40% of the corpus, which previously collapsed into 'automation'. */
export type RecipeCategory =
  | 'monitoring'
  | 'reporting'
  | 'automation'
  | 'communication'
  | 'data-sync'
  | 'analysis'
  | 'development'
  | 'content'
  | 'productivity';

/** Kind of value the user supplies during adoption for a `RecipeBinding`.
 *  Each kind that names a connector is an *implicit* dependency on that
 *  connector — the recipe should also list it in `requiredConnectors`
 *  (source of truth for eligibility) so the binding form only renders for
 *  recipes that pass eligibility. */
export type BindingKind =
  | { type: 'slack-channel'; multi?: boolean }
  | { type: 'google-drive-folder' }
  | { type: 'google-calendar' }
  | { type: 'github-repo'; multi?: boolean }
  | { type: 'email-address'; multi?: boolean }
  | { type: 'text'; placeholder?: string; multiline?: boolean }
  | { type: 'number'; min?: number; max?: number; unit?: string }
  | { type: 'cron'; presets?: { label: string; cron: string }[] }
  | { type: 'enum'; options: Array<{ value: string; label: string }>; multi?: boolean };

/** Concrete value supplied by the user during adoption. Always JSON-safe so
 *  it round-trips into `design_context`. Multi-select kinds produce arrays. */
export type BindingValue = string | number | boolean | string[];

/** A single variable the user fills in when adopting a recipe into a
 *  persona. The `variable` key matches a `{{variable}}` placeholder in
 *  `RecipeUseCaseTemplate.promptTemplate` and in any string field the
 *  template substitutes (title / description / capabilitySummary). */
export interface RecipeBinding {
  /** Placeholder name without braces — e.g. `briefingChannel`. */
  variable: string;
  /** Short human-readable label, sentence case. */
  label: string;
  /** One- or two-sentence help text. */
  description: string;
  kind: BindingKind;
  required: boolean;
  /** Optional default. For enum/select kinds, must match one of the
   *  declared option values. For `slack-channel`, this is a channel id
   *  string; the catalog can pre-fill it when the persona happens to have
   *  a channel by that name wired (best-effort, non-binding). */
  default?: BindingValue;
}

/** What the adopted use case looks like — modulo binding substitutions.
 *  Every string field may contain `{{variable}}` placeholders. The
 *  adoption flow substitutes bindings then writes the result into the
 *  persona's `design_context.useCases[]`. */
export interface RecipeUseCaseTemplate {
  title: string;
  description: string;
  capabilitySummary: string;
  /** Same taxonomy used by `DesignUseCase.category`. */
  category: string;
  suggestedTrigger?: {
    type: 'schedule' | 'polling' | 'webhook' | 'manual';
    cron?: string;
    description: string;
  };
  /** Tool keys the runtime should prefer when this use case is in focus. */
  toolHints: string[];
  /** Notification channel *types* the recipe expects; concrete channel
   *  configs are filled by bindings + the persona's wired credentials. */
  notificationChannelTypes: NotificationChannelType[];
  /** Default policy at adoption time — user can change later via the
   *  policy toggles on the SigilGrid tile or detail card. */
  generationSettings?: {
    memories?: 'on' | 'off';
    reviews?: 'on' | 'off' | 'trust_llm';
    events?: 'on' | 'off';
  };
  /** LLM prompt template — `{{variable}}` placeholders for bindings. */
  promptTemplate: string;
}

/** The shareable, persona-agnostic recipe record. */
export interface Recipe {
  /** Canonical UUID. Stable across version bumps — `version` discriminates. */
  id: string;
  /** URL-friendly identifier, also used as a stable display key when the
   *  ID is too noisy (e.g. analytics buckets, telemetry events). */
  slug: string;
  /** Display title — the Recipe's headline. */
  name: string;
  /** Single-line tagline (≤80 chars), shown on browse cards. */
  summary: string;
  /** Longer prose blurb (markdown allowed when we wire markdown rendering;
   *  treat as plain text for now). */
  description: string;
  category: RecipeCategory;

  /** Connectors that *must* be wired on the target persona before adoption.
   *  Source of truth for eligibility resolution. Slugs match
   *  `CONNECTOR_META` keys (e.g. `slack`, `google_drive`, `github`). */
  requiredConnectors: string[];
  /** Connectors that enhance the recipe but aren't required. Used to
   *  surface "unlock more by wiring X" hints, not to gate adoption. */
  optionalConnectors: string[];

  template: RecipeUseCaseTemplate;
  bindings: RecipeBinding[];

  // -- Curation metadata ------------------------------------------------
  /** True for team-curated recipes shipped with the app. v1 is curation-
   *  only — third-party authoring lands in Phase 4. */
  isBuiltin: boolean;
  /** Semver-style — bump major when bindings or template change in a
   *  breaking way (adopted use cases will need to reconcile). */
  version: string;
  /** ISO-8601 publication date. */
  publishedAt: string;
  /** "Personas Team" or contributor name. */
  author: string;

  // -- Display ---------------------------------------------------------
  /** Free-form tags. Used for search + secondary filter pills. */
  tags: string[];
  /** Connector slug whose icon represents this recipe at a glance. Falls
   *  back to the first entry in `requiredConnectors` if not set. */
  iconConnector?: string;
  /** Optional brand-style accent color (hex). Falls back to the connector's
   *  color via `CONNECTOR_META`. */
  color?: string;
}

// -- Eligibility -----------------------------------------------------------
//
// Resolved at view time against the *currently selected persona*. Recipes
// don't know about personas; this is purely a derivation in the catalog
// layer. Lives in `eligibility.ts`.

/** 3-state eligibility verdict for a recipe against a target persona. */
export type Eligibility =
  | { state: 'eligible' }
  | {
      state: 'adoptable-with-setup';
      /** Connectors required by the recipe that aren't yet wired on the
       *  persona but exist in the connector catalog so the user can wire
       *  them. The adoption wizard guides through these in order. */
      missingConnectors: string[];
    }
  | {
      state: 'incompatible';
      /** Human-readable reason — typically "tier locks the connector" or
       *  "platform doesn't support this connector". */
      reason: string;
      /** Connectors that can't be wired on this user's setup. */
      blockedConnectors: string[];
    };

/** Adopted snapshot — what gets written into the persona's
 *  `design_context.useCases[]` after a successful adoption. The structural
 *  fields are a `DesignUseCase` (we don't redeclare it here to avoid
 *  drift); these are the *extras* that record provenance so we can
 *  detect "needs update" if the source recipe is republished. */
export interface AdoptionMetadata {
  /** Recipe id at adoption time. */
  sourceRecipeId: string;
  /** Recipe slug + version pinned at adoption — drives the staleness
   *  badge when the catalog version moves ahead of this. */
  sourceRecipeSlug: string;
  sourceRecipeVersion: string;
  /** ISO-8601 — when the user adopted. */
  adoptedAt: string;
  /** The binding values the user supplied. Persisted so future re-runs
   *  with newer recipe versions can carry forward + flag what changed. */
  bindingValues: Record<string, BindingValue>;
}

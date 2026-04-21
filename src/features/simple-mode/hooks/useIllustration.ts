/**
 * Illustration resolver for Simple-mode persona tiles.
 *
 * Given any Persona, deterministically returns one of twelve warm watercolor
 * category illustrations pre-staged under `public/illustrations/simple-mode/`.
 *
 * Tier cascade (first match wins):
 *   1. **Emoji map** — `persona.icon` first grapheme → EMOJI_MAP
 *   2. **Keyword scan** — lowercase `persona.name + persona.description +
 *      parsed design_context free-text` scanned against KEYWORD_MAP entries,
 *      in declaration order. Phase 16 folded `design_context.summary` +
 *      `useCases[].name/description` into the haystack; see
 *      `extractDesignContextText` below.
 *   3. **Template metadata hint** — NOT available in v1 and still deferred
 *      after Phase 16 investigation (no clean category source exists; see the
 *      Tier-3 comment block inside `resolveIllustration` for full rationale).
 *   4. **Deterministic hash** — stable string hash of `persona.id` → index into
 *      the twelve-category tuple. Ensures a persona with no hints always lands
 *      on the same illustration across runs.
 *
 * Output is a pure `{ category, url }` object. The `url` is a runtime string
 * (never an `import`) because PNGs live under `public/`, not `src/`, matching
 * Tauri's public-asset convention.
 *
 * Pure / deterministic / no store access. `useIllustration` is a thin
 * `useMemo` wrapper around `resolveIllustration`.
 */

import { useMemo } from 'react';

import type { Persona } from '@/lib/bindings/Persona';

export const CATEGORIES = [
  'email',
  'chat',
  'code',
  'writing',
  'finance',
  'calendar',
  'research',
  'design',
  'data',
  'meetings',
  'social',
  'general',
] as const;

export type IllustrationCategory = (typeof CATEGORIES)[number];

export interface ResolvedIllustration {
  category: IllustrationCategory;
  /** Runtime URL beginning with `/illustrations/simple-mode/...` */
  url: string;
}

// Tier 1: explicit icon-emoji → category mapping.
const EMOJI_MAP: Record<string, IllustrationCategory> = {
  '📧': 'email',   '✉': 'email',    '📬': 'email',   '📨': 'email',   '📮': 'email',
  '💬': 'chat',    '🗨': 'chat',    '💭': 'chat',
  '🔍': 'code',    '👨‍💻': 'code', '💻': 'code',   '⚙': 'code',    '🔧': 'code',  '🐛': 'code',
  '✍': 'writing', '📝': 'writing', '📃': 'writing', '📄': 'writing', '🖋': 'writing',
  '🧾': 'finance', '💰': 'finance', '💳': 'finance', '💸': 'finance',
  '📅': 'calendar','📆': 'calendar','☀': 'calendar','🌅': 'calendar',
  '📚': 'research','🔎': 'research','📖': 'research',
  '🎨': 'design',  '🖌': 'design',  '🖼': 'design',
  '📊': 'data',    '📈': 'data',    '📉': 'data',    '🔢': 'data',
  '👥': 'meetings','🤝': 'meetings','📞': 'meetings','🗣': 'meetings',
  '🌐': 'social',  '🔗': 'social',  '📡': 'social',
};

// Tier 2: case-insensitive keyword scan against name + description.
// Declaration order is significant — earlier entries win ties.
const KEYWORD_MAP: Array<[keywords: string[], category: IllustrationCategory]> = [
  [['email', 'mail', 'inbox', 'gmail', 'outlook'],                        'email'],
  [['slack', 'discord', 'chat', 'message', 'direct message', 'dms', 'dming'], 'chat'],
  [['github', 'gitlab', 'code', 'pull request', 'pr review', 'bug', 'review'], 'code'],
  [['write', 'writer', 'draft', 'blog', 'post', 'note', 'notion', 'doc'], 'writing'],
  [['invoice', 'receipt', 'payment', 'budget', 'expense', 'finance', 'billing'], 'finance'],
  [['calendar', 'schedule', 'agenda', 'briefing', 'morning'],             'calendar'],
  [['research', 'study', 'summary', 'digest', 'read'],                    'research'],
  [['design', 'figma', 'sketch', 'mockup', 'wireframe'],                  'design'],
  [['metric', 'analytic', 'dashboard', 'chart', 'graph', 'data', 'report'], 'data'],
  [['meeting', 'zoom', 'conference', 'standup', 'sync', 'call'],          'meetings'],
  [['linkedin', 'twitter', 'social', 'post', 'share'],                    'social'],
];

/**
 * Simple cumulative char-code hash. Stable across runs and engines.
 * Returns a non-negative integer.
 */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Build the runtime URL for a given category.
 * Tauri serves `public/` at root, so this is the live asset path.
 */
function urlFor(category: IllustrationCategory): string {
  return `/illustrations/simple-mode/category-${category}.png`;
}

type PersonaLike = Pick<Persona, 'id' | 'name' | 'description' | 'icon' | 'design_context'>;

/**
 * Extract scannable text from a Persona's `design_context` TEXT column.
 *
 * `design_context` is an optional JSON-encoded string authored during the
 * design-review flow. Observed shape (see `src-tauri/src/db/models/persona.rs`):
 *   {
 *     designFiles:       { files: [], references: [] },
 *     credentialLinks:   Record<string, string>,
 *     useCases:          Array<{ name, description, ... }>,
 *     summary:           string,
 *     connectorPipeline: ConnectorPipelineStep[],
 *     twinId?:           string,
 *   }
 *
 * We pull just the free-text fields most likely to carry keyword signal
 * (`summary` + `useCases[].name` + `useCases[].description`) and concatenate
 * them with spaces. Any parse failure — malformed JSON, unexpected shape,
 * non-string field — is swallowed: the resolver is a best-effort helper, not
 * a correctness boundary.
 *
 * Phase 16 addition (see .planning/phases/16-deferred-resolution/16-01-PLAN.md
 * ITEM A): broader Tier-2 haystack without requiring schema work.
 */
function extractDesignContextText(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof parsed.summary === 'string') parts.push(parsed.summary);
    const useCases = parsed.useCases;
    if (Array.isArray(useCases)) {
      for (const uc of useCases) {
        if (uc && typeof uc === 'object') {
          const o = uc as Record<string, unknown>;
          if (typeof o.name === 'string') parts.push(o.name);
          if (typeof o.description === 'string') parts.push(o.description);
        }
      }
    }
    return parts.join(' ');
  } catch {
    return '';
  }
}

/**
 * Pure resolver, exported for unit tests + for callers that don't need React.
 *
 * Walks the four-tier cascade documented in this file's header and returns a
 * `{ category, url }` object. Guaranteed to return a valid category from
 * `CATEGORIES` for any input — never throws, never returns null.
 */
export function resolveIllustration(persona: PersonaLike): ResolvedIllustration {
  // Short-circuit: truly empty persona resolves to 'general' (the
  // intentional "no-hints" bucket). Without this, a persona with an empty id
  // string would hash to 0 and land on CATEGORIES[0] === 'email', which is
  // misleading for a persona that has no email affinity at all.
  if (!persona.id && !persona.name && !persona.description && !persona.icon) {
    return { category: 'general', url: urlFor('general') };
  }

  // Tier 1: emoji lookup.
  // Emojis like '👨‍💻' are multi-codepoint ZWJ sequences; iterating via
  // `Array.from` splits them into their component codepoints. We try each
  // component against EMOJI_MAP so both a ZWJ sequence present as a literal
  // key (e.g., '👨‍💻') AND its components (e.g., '💻') can resolve.
  const icon = persona.icon ?? '';
  if (icon) {
    // Try the full icon string first — catches literal ZWJ-sequence keys.
    if (EMOJI_MAP[icon]) {
      return { category: EMOJI_MAP[icon], url: urlFor(EMOJI_MAP[icon]) };
    }
    // Walk component codepoints (grapheme-ish) and return the first hit.
    for (const char of Array.from(icon)) {
      const cat = EMOJI_MAP[char];
      if (cat) {
        return { category: cat, url: urlFor(cat) };
      }
    }
  }

  // Tier 2: keyword scan against name + description + design_context text.
  //
  // Phase 16 enrichment: `design_context` is a JSON TEXT column populated by
  // the design-review flow. When present, it often carries use-case names,
  // descriptions, and a summary string that are stronger keyword signal than
  // the terse persona.name alone. `extractDesignContextText` wraps JSON.parse
  // in try/catch so malformed context never crashes the resolver.
  const contextText = extractDesignContextText(persona.design_context);
  const haystack = `${persona.name ?? ''} ${persona.description ?? ''} ${contextText}`.toLowerCase();
  if (haystack.trim().length > 0) {
    for (const [keywords, category] of KEYWORD_MAP) {
      for (const kw of keywords) {
        if (haystack.includes(kw)) {
          return { category, url: urlFor(category) };
        }
      }
    }
  }

  // Tier 3 — template-category metadata (deferred — investigated Phase 16)
  //
  // Investigation summary: the data needed for a clean tier-3 mapping does NOT
  // exist in the current frontend bindings. Options evaluated:
  //
  //   (a) Add `template_category` to Persona schema:
  //       • No template link from Persona exists (source_review_id dead-ends
  //         at persona_design_reviews, which has no template_id FK).
  //       • Would require a new templates table + backfill logic + Rust +
  //         ts-rs regeneration.
  //       • Standalone phase, not polish.
  //
  //   (b) Parse Persona.design_context JSON for a category enum:
  //       • The JSON exists (`useCases`, `summary`, `connectorPipeline`) but
  //         carries no category enum — raw context data, not metadata.
  //       • The template system uses a different 30+ category vocabulary
  //         (automation / productivity / ops / ...) that does not map cleanly
  //         to the resolver's 12 functional bins (email / chat / code / ...).
  //       • Instead, Tier-2 is enriched in Phase 16 to fold design_context
  //         free-text into the keyword scan (see `extractDesignContextText`
  //         above). Captures most of the available signal without a schema
  //         change.
  //
  // Tier-2 (enriched) + Tier-4 hash cover the common case. Revisit when a user
  // reports systematic mis-assignment or when template-category becomes
  // first-class in Persona metadata.
  //
  // See .planning/phases/16-deferred-resolution/16-01-PLAN.md ITEM A.

  // Tier 4: deterministic hash of id. `hashId('')` returns 0, which maps to
  // CATEGORIES[0] === 'email'. The empty-persona short-circuit above handles
  // the fully-empty case; at this point persona has at least one signal
  // (name/description/icon) so the hash is meaningful enough to be stable.
  // `hashId(id) % CATEGORIES.length` is always a valid index into the tuple,
  // so the non-null assertion is safe despite noUncheckedIndexedAccess.
  const category = CATEGORIES[hashId(persona.id ?? '') % CATEGORIES.length]!;
  return { category, url: urlFor(category) };
}

/**
 * React hook wrapper for callers inside components. Memoized on the four
 * persona fields the resolver actually reads.
 */
export function useIllustration(persona: PersonaLike): ResolvedIllustration {
  return useMemo(
    () => resolveIllustration(persona),
    [persona.id, persona.icon, persona.name, persona.description],
  );
}

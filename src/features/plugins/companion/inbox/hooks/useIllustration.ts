/**
 * Illustration resolver for persona tiles in the Cockpit and inline cards.
 *
 * Given any Persona, deterministically returns one of twelve warm watercolor
 * category illustrations staged under `public/illustrations/personas/`.
 *
 * Tier cascade (first match wins):
 *   1. **Emoji map** — `persona.icon` first grapheme → EMOJI_MAP
 *   2. **Keyword scan** — lowercase `persona.name + persona.description +
 *      parsed design_context free-text` scanned against KEYWORD_MAP entries,
 *      in declaration order. Folds `design_context.summary` +
 *      `useCases[].name/description` into the haystack.
 *   3. **Template-category tier** — `persona.template_category` (populated by
 *      the Rust `infer_template_category` heuristic) mapped through
 *      `TEMPLATE_CATEGORY_MAP` to the 12 illustration bins.
 *   4. **Deterministic hash** — stable string hash of `persona.id` → index
 *      into the twelve-category tuple.
 *
 * Output is a pure `{ category, url }` object. The `url` is a runtime string
 * because PNGs live under `public/`, not `src/`, matching Tauri's public-asset
 * convention.
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
  /** Runtime URL beginning with `/illustrations/personas/...` */
  url: string;
}

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

const TEMPLATE_CATEGORY_MAP: Record<string, IllustrationCategory> = {
  development: 'code',
  devops: 'code',
  testing: 'code',
  security: 'code',
  monitoring: 'data',
  data: 'data',
  communication: 'chat',
  support: 'chat',
  email: 'email',
  content: 'writing',
  documentation: 'writing',
  research: 'research',
  sales: 'finance',
  finance: 'finance',
  marketing: 'social',
  hr: 'meetings',
  legal: 'writing',
  project_management: 'meetings',
  productivity: 'general',
};

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
 * Exported so other cockpit surfaces can derive deterministic visual choices
 * from the same hash without re-implementing.
 */
export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function urlFor(category: IllustrationCategory): string {
  return `/illustrations/personas/category-${category}.png`;
}

type PersonaLike = Pick<
  Persona,
  'id' | 'name' | 'description' | 'icon' | 'design_context' | 'template_category'
>;

/**
 * Extract scannable text from a Persona's `design_context` TEXT column.
 * Pulls `summary` + `useCases[].name` + `useCases[].description`. Any parse
 * failure is swallowed.
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
 * Pure resolver. Walks the four-tier cascade and returns a `{ category, url }`
 * object. Guaranteed to return a valid category for any input — never throws.
 */
export function resolveIllustration(persona: PersonaLike): ResolvedIllustration {
  if (!persona.id && !persona.name && !persona.description && !persona.icon) {
    return { category: 'general', url: urlFor('general') };
  }

  const icon = persona.icon ?? '';
  if (icon) {
    if (EMOJI_MAP[icon]) {
      return { category: EMOJI_MAP[icon], url: urlFor(EMOJI_MAP[icon]) };
    }
    for (const char of Array.from(icon)) {
      const cat = EMOJI_MAP[char];
      if (cat) {
        return { category: cat, url: urlFor(cat) };
      }
    }
  }

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

  if (persona.template_category) {
    const mapped = TEMPLATE_CATEGORY_MAP[persona.template_category];
    if (mapped) {
      return { category: mapped, url: urlFor(mapped) };
    }
  }

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
    [persona.id, persona.icon, persona.name, persona.description, persona.template_category],
  );
}

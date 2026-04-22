/**
 * Derive the set of category tags a template claims, by examining each
 * connector it declares and unioning the tags.
 *
 * Two sources feed the tag set:
 *   1. `connectorCategoryTags(name)` — the multi-tag catalog on builtin
 *      connectors. A connector like `leonardo_ai` claims
 *      [ai, image_generation, video_generation]; a connector like `stripe`
 *      claims [finance, payments, billing, subscriptions, ecommerce].
 *   2. Template-authored generic slots (e.g. "messaging", "crm",
 *      "storage", "email") — these aren't connector names, they ARE the
 *      category. The v3.1 de-branding pass rewrote all tool connectors
 *      into these role slots, so a template's raw connectors[] is now
 *      a mix of concrete names and abstract slot names.
 *
 * Unknown tags (missing from the ARCH_CATEGORIES map) are returned with
 * `isUnknown: true` so the gallery can render them in a warning style —
 * this is the "typo catcher" audit mechanism for the 107-template review.
 */
import { connectorCategoryTags, BUILTIN_CONNECTORS } from '@/lib/credentials/builtinConnectors';
import { ARCH_CATEGORIES, type ArchCategory } from '../matrix/architecturalCategories';

export interface TemplateCategoryPill {
  /** Canonical category key (from connector-categories.json or the raw tag). */
  key: string;
  /** Human-facing label (category label when known, raw key when not). */
  label: string;
  /** Icon + color from ARCH_CATEGORIES when known; null when not. */
  arch: ArchCategory | null;
  /** True when the category key is not in the vault catalog — audit flag. */
  isUnknown: boolean;
}

// Set of names that exist as concrete connectors in the builtin catalog.
// Used to distinguish "leonardo_ai" (real connector → look up categories[])
// from "messaging" (abstract slot → slot name IS the category).
const KNOWN_CONNECTOR_NAMES = new Set(BUILTIN_CONNECTORS.map((c) => c.name));

// Some catalog keys differ from the multi-tag keys used on connectors.
// e.g. the catalog uses `project-mgmt` (kebab) while the multi-tag uses
// `project_management` (snake). Map the connector-tag form to the catalog
// form so pills render with the right icon/color.
const TAG_ALIASES: Record<string, string> = {
  project_management: 'project-mgmt',
  time_tracking: 'time-tracking',
};

function normalizeTag(tag: string): string {
  return TAG_ALIASES[tag] ?? tag;
}

export function deriveTemplateCategoryTags(
  connectorNames: string[],
): TemplateCategoryPill[] {
  const seen = new Set<string>();
  const out: TemplateCategoryPill[] = [];

  const push = (rawKey: string) => {
    const key = normalizeTag(rawKey);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const arch = ARCH_CATEGORIES[key] ?? null;
    out.push({
      key,
      label: arch ? arch.label : rawKey,
      arch,
      isUnknown: !arch,
    });
  };

  for (const name of connectorNames) {
    if (!name) continue;
    if (KNOWN_CONNECTOR_NAMES.has(name)) {
      // Real builtin connector → use its full multi-tag set.
      const tags = connectorCategoryTags(name);
      if (tags.length === 0) {
        // Defensive: a listed builtin with no category still deserves a pill.
        push(name);
      } else {
        for (const t of tags) push(t);
      }
    } else {
      // Generic slot / unknown name — treat the string itself as a category.
      push(name);
    }
  }

  return out;
}

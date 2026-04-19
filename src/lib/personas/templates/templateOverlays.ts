/**
 * Per-language template overlays.
 *
 * Canonical template files live at `scripts/templates/<category>/<name>.json`
 * (English, structural source of truth). Translations are sibling files
 * `scripts/templates/<category>/<name>.<lang>.json` that carry only
 * user-facing strings — structural fields (ids, cron, connector names,
 * event types, maps_to paths) stay single-sourced in the canonical file.
 *
 * At runtime, `mergeTemplateOverlay` combines the two into a localized
 * template the rest of the app consumes. Structural integrity is gated
 * by the checksum on the English canonical (in templateCatalog.ts) —
 * overlays are not independently checksummed.
 */
import type { LocaleCode } from '@/i18n/locales.manifest';
import { createLogger } from '@/lib/log';

const logger = createLogger('template-overlays');

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// Keys that identify items in arrays of objects for schema-aware merge.
// The first matching key (in order) wins. Covers every object-array shape
// in the v3 template schema:
//   - use_cases[]                → id
//   - use_case_flow.nodes[]      → id
//   - adoption_questions[]       → id
//   - connectors[]               → name
//   - input_schema[]             → name
//   - credential_fields[]        → key
//   - event_subscriptions[]      → event_type
//   - notification_channels[]    → (no key; falls back to index)
const MATCH_KEYS = ['id', 'name', 'key', 'event_type'] as const;

function isPlainObject(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function findMatchKey(obj: Record<string, Json>): string | undefined {
  for (const k of MATCH_KEYS) {
    if (typeof obj[k] === 'string') return k;
  }
  return undefined;
}

function mergeArray(canonical: Json[], overlay: Json[]): Json[] {
  // Primitive array (strings, numbers): overlay wholly replaces.
  // This is how we handle principles[], constraints[], decision_principles[],
  // options[], etc. Overlay must provide the entire translated list.
  if (overlay.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
    return overlay;
  }

  // Object array: match by schema key when available, otherwise by index.
  const firstCanon = canonical.find(isPlainObject);
  const firstOverlay = overlay.find(isPlainObject);
  const canonKey = firstCanon ? findMatchKey(firstCanon) : undefined;
  const overlayKey = firstOverlay ? findMatchKey(firstOverlay) : undefined;
  const matchKey = canonKey && canonKey === overlayKey ? canonKey : undefined;

  const result = [...canonical];

  if (matchKey) {
    const canonIndex = new Map<string, number>();
    canonical.forEach((item, idx) => {
      if (isPlainObject(item) && typeof item[matchKey] === 'string') {
        canonIndex.set(item[matchKey] as string, idx);
      }
    });

    for (const overlayItem of overlay) {
      if (!isPlainObject(overlayItem)) continue;
      const key = overlayItem[matchKey];
      if (typeof key !== 'string') continue;
      const idx = canonIndex.get(key);
      if (idx === undefined) continue; // overlay references unknown item — skip
      const canonItem = result[idx];
      if (isPlainObject(canonItem)) {
        result[idx] = mergeObject(canonItem, overlayItem);
      }
    }
    return result;
  }

  // No match key — index-based merge. Used for notification_channels[]
  // ({ type, description }) where order matters and is stable.
  for (let i = 0; i < overlay.length && i < result.length; i++) {
    const canonItem = result[i];
    const overlayItem = overlay[i];
    if (isPlainObject(canonItem) && isPlainObject(overlayItem)) {
      result[i] = mergeObject(canonItem, overlayItem);
    }
  }
  return result;
}

function mergeObject(
  canonical: Record<string, Json>,
  overlay: Record<string, Json>,
): Record<string, Json> {
  const result: Record<string, Json> = { ...canonical };
  for (const [k, overlayValue] of Object.entries(overlay)) {
    if (overlayValue === null || overlayValue === undefined) continue;
    const canonValue = canonical[k];
    if (isPlainObject(overlayValue) && isPlainObject(canonValue)) {
      result[k] = mergeObject(canonValue, overlayValue);
    } else if (Array.isArray(overlayValue) && Array.isArray(canonValue)) {
      result[k] = mergeArray(canonValue, overlayValue);
    } else {
      // Primitive or type-mismatch: overlay wins.
      result[k] = overlayValue;
    }
  }
  return result;
}

/**
 * Produce a localized template by overlaying translated strings onto the
 * canonical English template. `overlay` may be a partial — fields absent
 * from the overlay fall through to canonical. `{{param.X}}` tokens in
 * either source are preserved verbatim.
 */
export function mergeTemplateOverlay<T>(canonical: T, overlay: unknown): T {
  if (!isPlainObject(overlay)) return canonical;
  if (!isPlainObject(canonical as unknown)) return canonical;
  return mergeObject(
    canonical as unknown as Record<string, Json>,
    overlay as Record<string, Json>,
  ) as unknown as T;
}

// ---------------------------------------------------------------------------
// Overlay file discovery + lazy loading
// ---------------------------------------------------------------------------

const OVERLAY_SUFFIX_RE = /\.(ar|bn|cs|de|es|fr|hi|id|ja|ko|ru|vi|zh)\.json$/;

/** Glob of every sibling overlay file under scripts/templates/. */
const overlayLoaders = import.meta.glob<{ id: string } & Record<string, unknown>>(
  [
    '../../../../scripts/templates/**/*.ar.json',
    '../../../../scripts/templates/**/*.bn.json',
    '../../../../scripts/templates/**/*.cs.json',
    '../../../../scripts/templates/**/*.de.json',
    '../../../../scripts/templates/**/*.es.json',
    '../../../../scripts/templates/**/*.fr.json',
    '../../../../scripts/templates/**/*.hi.json',
    '../../../../scripts/templates/**/*.id.json',
    '../../../../scripts/templates/**/*.ja.json',
    '../../../../scripts/templates/**/*.ko.json',
    '../../../../scripts/templates/**/*.ru.json',
    '../../../../scripts/templates/**/*.vi.json',
    '../../../../scripts/templates/**/*.zh.json',
    '!../../../../scripts/templates/_*/**',
  ],
  { import: 'default' },
);

/**
 * Extract the language code from an overlay module path.
 * Returns null if the path is not a recognized sibling file.
 */
export function languageFromOverlayPath(path: string): LocaleCode | null {
  const m = path.match(OVERLAY_SUFFIX_RE);
  return m ? (m[1] as LocaleCode) : null;
}

/**
 * Load every overlay for a given language. Each overlay is keyed by the
 * template `id` field inside the file (so the catalog can match it up
 * with the canonical entry regardless of filesystem layout changes).
 *
 * Result is cached per language — second call is free.
 */
const _overlayCache = new Map<LocaleCode, Promise<Map<string, unknown>>>();

export function loadOverlaysForLanguage(lang: LocaleCode): Promise<Map<string, unknown>> {
  const cached = _overlayCache.get(lang);
  if (cached) return cached;

  const promise = (async () => {
    const matched = Object.entries(overlayLoaders).filter(
      ([path]) => languageFromOverlayPath(path) === lang,
    );

    const entries = await Promise.all(
      matched.map(async ([path, loader]) => {
        try {
          const overlay = (await loader()) as Record<string, unknown>;
          const id = typeof overlay.id === 'string' ? overlay.id : null;
          if (!id) {
            logger.warn('Overlay missing id field, skipping', { path });
            return null;
          }
          return [id, overlay] as const;
        } catch (err) {
          logger.warn('Failed to load overlay', { path, err });
          return null;
        }
      }),
    );

    const byId = new Map<string, unknown>();
    for (const entry of entries) {
      if (entry) byId.set(entry[0], entry[1]);
    }
    return byId;
  })();

  _overlayCache.set(lang, promise);
  return promise;
}

/** Invalidate the overlay cache (used by HMR hook during dev). */
export function invalidateOverlayCache(): void {
  _overlayCache.clear();
}

/**
 * Detect whether a template filename looks like a sibling translation
 * rather than a canonical template. Used by the catalog glob filter and
 * the checksum script so siblings don't get independent checksums.
 */
export function isOverlayFilename(filename: string): boolean {
  return OVERLAY_SUFFIX_RE.test(filename);
}

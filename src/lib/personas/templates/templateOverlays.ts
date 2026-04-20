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
import * as Sentry from '@sentry/react';

const logger = createLogger('template-overlays');

/** Structured record of an overlay that referenced an unknown canonical id. */
export interface OverlayIdMismatch {
  /** Which canonical container the mismatch happened in (array path within the template). */
  container: string;
  /** The field that's supposed to match canonical (id, name, key, event_type). */
  matchKey: string;
  /** The overlay value that had no match in canonical. */
  overlayValue: string;
}

/**
 * Collected mismatches for the most recent merge — consumed by the locale
 * parity script / tests to fail the build when a translator renames a
 * canonical id. In prod we only `logger.warn` (non-fatal, test via Sentry).
 */
const _currentMergeMismatches: OverlayIdMismatch[] = [];

function recordIdMismatch(mismatch: OverlayIdMismatch, locale?: LocaleCode, templateId?: string) {
  _currentMergeMismatches.push(mismatch);
  logger.warn('Overlay references unknown canonical id', { ...mismatch, locale, templateId });
  try {
    Sentry.addBreadcrumb({
      category: 'template-overlay',
      level: 'warning',
      message: `Overlay id mismatch in ${mismatch.container}`,
      data: { ...mismatch, locale, templateId },
    });
  } catch { /* intentional: Sentry may be uninitialized in dev */ }
  // In test (vitest), throw so locale-parity suites fail loudly; in dev warn
  // via the logger above; in prod the breadcrumb + warn is enough.
  const env = (import.meta as unknown as { vitest?: unknown; env?: { MODE?: string } });
  if (env?.vitest !== undefined || env?.env?.MODE === 'test') {
    throw new Error(
      `Overlay id mismatch: ${mismatch.container}.${mismatch.matchKey}="${mismatch.overlayValue}" has no canonical entry` +
        (templateId ? ` (template ${templateId})` : '') +
        (locale ? ` (locale ${locale})` : ''),
    );
  }
}

/** Drain the most recent merge's mismatches — for use by parity tests. */
export function drainOverlayMismatches(): OverlayIdMismatch[] {
  return _currentMergeMismatches.splice(0, _currentMergeMismatches.length);
}

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

/** Merge context threaded through recursion so mismatch reports know their path. */
interface MergeCtx {
  locale?: LocaleCode;
  templateId?: string;
  /** Dotted path to the current node from the template root (for mismatch logs). */
  path: string;
}

function mergeArray(canonical: Json[], overlay: Json[], ctx: MergeCtx): Json[] {
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
      if (idx === undefined) {
        // Overlay references a canonical id that doesn't exist — likely a
        // translator renamed a use-case id, a connector key, or an
        // adoption_questions.id. Silently skipping leaves the English string
        // in place with no signal; surface the mismatch instead.
        recordIdMismatch(
          { container: ctx.path, matchKey, overlayValue: key },
          ctx.locale,
          ctx.templateId,
        );
        continue;
      }
      const canonItem = result[idx];
      if (isPlainObject(canonItem)) {
        result[idx] = mergeObject(canonItem, overlayItem, {
          ...ctx,
          path: `${ctx.path}[${key}]`,
        });
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
      result[i] = mergeObject(canonItem, overlayItem, {
        ...ctx,
        path: `${ctx.path}[${i}]`,
      });
    }
  }
  return result;
}

function mergeObject(
  canonical: Record<string, Json>,
  overlay: Record<string, Json>,
  ctx: MergeCtx,
): Record<string, Json> {
  const result: Record<string, Json> = { ...canonical };
  for (const [k, overlayValue] of Object.entries(overlay)) {
    if (overlayValue === null || overlayValue === undefined) continue;
    const canonValue = canonical[k];
    const childCtx: MergeCtx = { ...ctx, path: ctx.path ? `${ctx.path}.${k}` : k };
    if (isPlainObject(overlayValue) && isPlainObject(canonValue)) {
      result[k] = mergeObject(canonValue, overlayValue, childCtx);
    } else if (Array.isArray(overlayValue) && Array.isArray(canonValue)) {
      result[k] = mergeArray(canonValue, overlayValue, childCtx);
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
 *
 * The optional `ctx` is used only for mismatch diagnostics; the merge itself
 * doesn't depend on it, so tests and parity scripts can still call with no args.
 */
export function mergeTemplateOverlay<T>(
  canonical: T,
  overlay: unknown,
  ctx: { locale?: LocaleCode; templateId?: string } = {},
): T {
  if (!isPlainObject(overlay)) return canonical;
  if (!isPlainObject(canonical as unknown)) return canonical;
  return mergeObject(
    canonical as unknown as Record<string, Json>,
    overlay as Record<string, Json>,
    { ...ctx, path: '' },
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
            // Expected template id can be recovered from the filename: the
            // canonical is `<name>.json` and the overlay is `<name>.<lang>.json`.
            const filename = path.split('/').pop() ?? path;
            const expectedTemplateId = filename.replace(OVERLAY_SUFFIX_RE, '');
            const overlayKeys = Object.keys(overlay);
            logger.warn('Overlay missing id field, skipping', {
              path,
              locale: lang,
              expectedTemplateId,
              overlayKeys,
            });
            try {
              Sentry.addBreadcrumb({
                category: 'template-overlay',
                level: 'warning',
                message: `Overlay missing id: ${filename}`,
                data: { path, locale: lang, expectedTemplateId, overlayKeys },
              });
            } catch { /* intentional: Sentry may be uninitialized */ }
            return null;
          }
          return [id, overlay] as const;
        } catch (err) {
          logger.warn('Failed to load overlay', { path, locale: lang, err });
          try {
            Sentry.addBreadcrumb({
              category: 'template-overlay',
              level: 'error',
              message: 'Failed to load overlay file',
              data: { path, locale: lang, error: err instanceof Error ? err.message : String(err) },
            });
          } catch { /* intentional */ }
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

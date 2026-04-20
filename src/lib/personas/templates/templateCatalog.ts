/**
 * Template Catalog -- single source of truth for all template JSON files.
 *
 * Uses Vite glob import to LAZILY load every JSON under scripts/templates/,
 * excluding debug directories. Templates are loaded on first access via
 * getTemplateCatalog(), not at module init. This defers ~3.7MB of JS
 * parsing from the critical startup path.
 *
 * Two-layer integrity verification:
 *   1. Client-side: fast check at first load (defense layer 1)
 *   2. Backend (Rust): authoritative async check against checksums embedded
 *      in the native binary, which is much harder to tamper with (defense layer 2)
 */
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import type { LocaleCode } from '@/i18n/locales.manifest';
import { computeContentHashSync, registerBuiltinTemplates } from '@/lib/templates/templateVerification';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { TEMPLATE_CHECKSUMS } from './templateChecksums';
import {
  isOverlayFilename,
  loadOverlaysForLanguage,
  mergeTemplateOverlay,
} from './templateOverlays';
import { createLogger } from '@/lib/log';

const logger = createLogger('template-catalog');

// Lazy glob: each entry is an async loader function, NOT the resolved module.
// The actual JSON is only fetched + parsed when the loader is called.
// Per-language sibling overlays (e.g. "name.cs.json") are filtered out here
// and loaded separately by templateOverlays.ts — they are NOT canonical
// templates and have no independent checksum.
const moduleLoaders = import.meta.glob<TemplateCatalogEntry>(
  [
    '../../../../scripts/templates/**/*.json',
    '!../../../../scripts/templates/_*/**',
  ],
  { import: 'default' },
);

function templatePathFromModulePath(modulePath: string): string {
  const marker = '/scripts/templates/';
  const idx = modulePath.lastIndexOf(marker);
  if (idx === -1) return modulePath;
  return modulePath.slice(idx + marker.length);
}

function filenameFromPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

// ---------------------------------------------------------------------------
// Lazy loading + verification
// ---------------------------------------------------------------------------

interface VerifiedEntry {
  template: TemplateCatalogEntry;
  relPath: string;
}

/**
 * Why a candidate template was dropped during verification.
 * - `missing_checksum` — template has no entry in TEMPLATE_CHECKSUMS (build-time bug).
 * - `checksum_mismatch` — content hash differs from the embedded checksum (tamper/corruption).
 * - `unpublished` — `is_published: false` in the JSON (intentional hide, not an error).
 */
export type CatalogSkipReason = 'missing_checksum' | 'checksum_mismatch' | 'unpublished';

/**
 * Thrown when two template JSON files claim the same `id`. This is always a
 * source bug (copy-paste without renaming), and silently last-wins dedupe is
 * platform-dependent (glob order differs Linux vs Windows), so we fail loudly
 * at catalog load and expose the colliding paths so the author can diff them.
 */
export class CatalogIntegrityError extends Error {
  constructor(
    public readonly duplicates: Record<string, string[]>,
    message?: string,
  ) {
    super(
      message ??
        `Duplicate template ids detected in catalog: ${Object.entries(duplicates)
          .map(([id, paths]) => `"${id}" → [${paths.join(', ')}]`)
          .join('; ')}`,
    );
    this.name = 'CatalogIntegrityError';
  }
}

export interface CatalogSkippedEntry {
  /** Relative path under `scripts/templates/`. */
  relPath: string;
  /** Template id if we could read it from the JSON, else null. */
  id: string | null;
  reason: CatalogSkipReason;
}

/**
 * Discriminated catalog load result. Lets the gallery tell the difference
 * between "no published templates" and "every template failed verification".
 *
 * - `ok`       → non-empty `templates`, no `skipped` due to errors.
 * - `partial`  → non-empty `templates`, but some were dropped for error reasons.
 * - `failed`   → zero `templates` AND at least one was dropped for an error reason.
 * - `empty`    → zero `templates`, every candidate was intentionally `unpublished`.
 */
export type CatalogLoadStatus = 'ok' | 'partial' | 'failed' | 'empty';

export interface CatalogLoadResult {
  status: CatalogLoadStatus;
  templates: TemplateCatalogEntry[];
  skipped: CatalogSkippedEntry[];
}

let _cached: VerifiedEntry[] | null = null;
let _cachedSkipped: CatalogSkippedEntry[] = [];
let _loading: Promise<VerifiedEntry[]> | null = null;

async function loadAndVerify(): Promise<VerifiedEntry[]> {
  const canonicalEntries = Object.entries(moduleLoaders).filter(
    ([modulePath]) => !isOverlayFilename(filenameFromPath(modulePath)),
  );

  const modules = await Promise.all(
    canonicalEntries.map(async ([modulePath, loader]) => {
      const template = await loader();
      return { modulePath, template };
    }),
  );

  const verified: VerifiedEntry[] = [];
  const skipped: CatalogSkippedEntry[] = [];
  for (const { modulePath, template } of modules) {
    const relPath = templatePathFromModulePath(modulePath);
    const id = (template as unknown as { id?: unknown })?.id;
    const safeId = typeof id === 'string' ? id : null;

    if ((template as unknown as Record<string, unknown>).is_published === false) {
      skipped.push({ relPath, id: safeId, reason: 'unpublished' });
      continue;
    }

    const expectedChecksum = TEMPLATE_CHECKSUMS[relPath];

    if (!expectedChecksum) {
      logger.warn('Missing checksum for built-in template, skipping', { relPath });
      skipped.push({ relPath, id: safeId, reason: 'missing_checksum' });
      continue;
    }

    const canonicalContent = JSON.stringify(template);
    const actualChecksum = computeContentHashSync(canonicalContent);
    if (actualChecksum !== expectedChecksum) {
      logger.warn('Integrity mismatch for built-in template, skipping', { relPath, expectedChecksum, actualChecksum });
      skipped.push({ relPath, id: safeId, reason: 'checksum_mismatch' });
      continue;
    }
    verified.push({ template, relPath });
  }

  // Detect id collisions before anyone downstream does a Map-by-id lookup
  // (e.g. overlays.get(template.id)). Silent last-wins dedupe depends on
  // glob ordering which differs between Linux and Windows, so we refuse to
  // serve a catalog that can't be uniquely addressed by id.
  const byId = new Map<string, string[]>();
  for (const v of verified) {
    const paths = byId.get(v.template.id);
    if (paths) paths.push(v.relPath);
    else byId.set(v.template.id, [v.relPath]);
  }
  const duplicates: Record<string, string[]> = {};
  for (const [id, paths] of byId) {
    if (paths.length > 1) duplicates[id] = paths;
  }
  if (Object.keys(duplicates).length > 0) {
    throw new CatalogIntegrityError(duplicates);
  }

  // Register all catalog templates as verified built-ins
  registerBuiltinTemplates(verified.map((v) => v.template.id));
  _cachedSkipped = skipped;

  return verified;
}

/**
 * Load and verify templates on demand. Cached after first call.
 * All consumers should use this instead of the sync TEMPLATE_CATALOG export.
 */
export async function getTemplateCatalog(): Promise<TemplateCatalogEntry[]> {
  if (_cached) return _cached.map((v) => v.template);
  if (!_loading) _loading = loadAndVerify();
  _cached = await _loading;
  return _cached.map((v) => v.template);
}

/**
 * Load the catalog and return a discriminated result so the UI can tell
 * empty-but-healthy from everything-failed.
 */
export async function getTemplateCatalogStatus(): Promise<CatalogLoadResult> {
  const templates = await getTemplateCatalog();
  const skipped = _cachedSkipped;
  const errorSkips = skipped.filter((s) => s.reason !== 'unpublished');
  let status: CatalogLoadStatus;
  if (templates.length === 0) {
    status = errorSkips.length > 0 ? 'failed' : 'empty';
  } else {
    status = errorSkips.length > 0 ? 'partial' : 'ok';
  }
  return { status, templates, skipped };
}

/**
 * Invalidate the in-memory catalog cache so the next `getTemplateCatalog()`
 * call re-parses every template JSON from the Vite glob loaders. Used by
 * the design-reviews hook to pick up template JSON edits made while the dev
 * server is running — without this, `_cached` survives remounts and serves
 * stale content even after the files change on disk.
 */
export function invalidateTemplateCatalog(): void {
  _cached = null;
  _loading = null;
  _localizedCache.clear();
}

// ---------------------------------------------------------------------------
// Localized catalog — applies per-language overlays to canonical templates.
// ---------------------------------------------------------------------------

const _localizedCache = new Map<LocaleCode, Promise<TemplateCatalogEntry[]>>();

/**
 * Return the template catalog with per-language translations applied.
 *
 * For `lang === 'en'` this is identical to `getTemplateCatalog()`. For any
 * other language it loads the sibling `<name>.<lang>.json` overlay files
 * and deep-merges their user-facing strings onto the verified canonical
 * templates. Overlays are not independently checksummed — structural
 * integrity is gated by the English canonical's checksum, which was
 * verified at catalog load time.
 *
 * Results are cached per language; invalidating the main catalog cache
 * (via `invalidateTemplateCatalog`) also clears all language caches.
 */
export async function getLocalizedTemplateCatalog(
  lang: LocaleCode,
): Promise<TemplateCatalogEntry[]> {
  if (lang === 'en') return getTemplateCatalog();

  const cached = _localizedCache.get(lang);
  if (cached) return cached;

  const promise = (async () => {
    const [canonical, overlays] = await Promise.all([
      getTemplateCatalog(),
      loadOverlaysForLanguage(lang),
    ]);

    if (overlays.size === 0) return canonical;

    // Detect overlays that reference a template id that no longer exists in
    // the canonical set — another silent-translation-regression surface.
    const canonicalIds = new Set(canonical.map((c) => c.id));
    for (const overlayId of overlays.keys()) {
      if (!canonicalIds.has(overlayId)) {
        logger.warn('Overlay references unknown template id', {
          locale: lang,
          overlayTemplateId: overlayId,
        });
      }
    }

    return canonical.map((template) => {
      const overlay = overlays.get(template.id);
      if (!overlay) return template;
      return mergeTemplateOverlay(template, overlay, { locale: lang, templateId: template.id });
    });
  })();

  _localizedCache.set(lang, promise);
  return promise;
}

/**
 * Localized variant of {@link getTemplateCatalogStatus}. Base-catalog skip
 * reasons are carried through unchanged — overlay mismatches are logged
 * separately (see `drainOverlayMismatches`) since they don't drop templates.
 */
export async function getLocalizedTemplateCatalogStatus(
  lang: LocaleCode,
): Promise<CatalogLoadResult> {
  const base = await getTemplateCatalogStatus();
  if (lang === 'en') return base;
  const localized = await getLocalizedTemplateCatalog(lang);
  return { ...base, templates: localized };
}

// -- Layer 2: Backend verification (async, authoritative) ----------------

interface BackendIntegrityResult {
  results: Array<{
    path: string;
    expectedHash: string | null;
    actualHash: string;
    valid: boolean;
    isKnownTemplate: boolean;
  }>;
  allValid: boolean;
  total: number;
  validCount: number;
  invalidCount: number;
  unknownCount: number;
}

/**
 * Asynchronously verify all client-side-passed templates against the
 * Rust backend's embedded checksum manifest.
 */
export async function verifyTemplatesWithBackend(): Promise<BackendIntegrityResult | null> {
  try {
    await getTemplateCatalog();
    const verified = _cached!;

    const entries = verified.map((v) => ({
      path: v.relPath,
      content: JSON.stringify(v.template),
    }));

    if (entries.length === 0) return null;

    const result = await invokeWithTimeout<BackendIntegrityResult>(
      'verify_template_integrity_batch',
      { templates: entries },
    );

    if (!result.allValid) {
      const invalid = result.results.filter((r) => r.isKnownTemplate && !r.valid);
      logger.error('SECURITY: template(s) failed backend integrity check, may have been tampered with', {
        count: invalid.length,
        paths: invalid.map((r) => r.path),
      });
    } else {
      logger.info('Backend integrity verified', { validCount: result.validCount, total: result.total });
    }

    return result;
  } catch (err) {
    logger.warn('Backend integrity verification unavailable', { err });
    return null;
  }
}

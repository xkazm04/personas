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
import { computeContentHashSync, registerBuiltinTemplates } from '@/lib/templates/templateVerification';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { TEMPLATE_CHECKSUMS } from './templateChecksums';
import { createLogger } from '@/lib/log';

const logger = createLogger('template-catalog');

// Lazy glob: each entry is an async loader function, NOT the resolved module.
// The actual JSON is only fetched + parsed when the loader is called.
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

// ---------------------------------------------------------------------------
// Lazy loading + verification
// ---------------------------------------------------------------------------

interface VerifiedEntry {
  template: TemplateCatalogEntry;
  relPath: string;
}

let _cached: VerifiedEntry[] | null = null;
let _loading: Promise<VerifiedEntry[]> | null = null;

async function loadAndVerify(): Promise<VerifiedEntry[]> {
  const modules = await Promise.all(
    Object.entries(moduleLoaders).map(async ([modulePath, loader]) => {
      const template = await loader();
      return { modulePath, template };
    }),
  );

  const verified: VerifiedEntry[] = [];
  for (const { modulePath, template } of modules) {
    if ((template as unknown as Record<string, unknown>).is_published === false) continue;

    const relPath = templatePathFromModulePath(modulePath);
    const expectedChecksum = TEMPLATE_CHECKSUMS[relPath];

    if (!expectedChecksum) {
      logger.warn('Missing checksum for built-in template, skipping', { relPath });
      continue;
    }

    const canonicalContent = JSON.stringify(template);
    const actualChecksum = computeContentHashSync(canonicalContent);
    if (actualChecksum !== expectedChecksum) {
      logger.warn('Integrity mismatch for built-in template, skipping', { relPath, expectedChecksum, actualChecksum });
      continue;
    }
    verified.push({ template, relPath });
  }

  // Register all catalog templates as verified built-ins
  registerBuiltinTemplates(verified.map((v) => v.template.id));

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

/**
 * Template Catalog -- single source of truth for all template JSON files.
 *
 * Uses Vite glob import to eagerly load every JSON under scripts/templates/,
 * excluding debug directories. Also registers all built-in template IDs
 * for origin verification.
 *
 * Two-layer integrity verification:
 *   1. Client-side: fast synchronous check at module init (defense layer 1)
 *   2. Backend (Rust): authoritative async check against checksums embedded
 *      in the native binary, which is much harder to tamper with (defense layer 2)
 */
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { computeContentHashSync, registerBuiltinTemplates } from '@/lib/templates/templateVerification';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { TEMPLATE_CHECKSUMS } from './templateChecksums';
import { createLogger } from '@/lib/log';

const logger = createLogger('template-catalog');

// Lazy glob: templates are loaded on first access to TEMPLATE_CATALOG,
// not at module init. This defers ~50MB of JSON parsing until needed.
const moduleLoaders = import.meta.glob<TemplateCatalogEntry>(
  [
    '../../../../scripts/templates/**/*.json',
    '!../../../../scripts/templates/_*/**',
  ],
  { eager: true, import: 'default' },
);
const modules = moduleLoaders;

function templatePathFromModulePath(modulePath: string): string {
  const marker = '/scripts/templates/';
  const idx = modulePath.lastIndexOf(marker);
  if (idx === -1) return modulePath;
  return modulePath.slice(idx + marker.length);
}

// -- Layer 1: Client-side verification (synchronous, immediate) ----------
// NOTE: canonicalContent is NOT stored — it was 50MB+ of duplicated JSON strings.
// It's regenerated on-demand in verifyTemplatesWithBackend() (runs once, async).

interface VerifiedEntry {
  template: TemplateCatalogEntry;
  relPath: string;
}

const verified: VerifiedEntry[] = [];

for (const [modulePath, template] of Object.entries(modules)) {
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
  // Don't store canonicalContent — regenerate on demand to save ~50MB heap
  verified.push({ template, relPath });
}

/** Every verified template in the catalog. */
export const TEMPLATE_CATALOG: TemplateCatalogEntry[] = verified.map((v) => v.template);

// Register all catalog templates as verified built-ins
registerBuiltinTemplates(TEMPLATE_CATALOG.map((t) => t.id));

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
 * Rust backend's embedded checksum manifest. This runs after initial
 * catalog load and flags any discrepancies between the frontend bundle's
 * checksums and the authoritative backend manifest.
 *
 * If any template fails backend verification, it is logged with a
 * security warning. The template is NOT removed from the catalog at
 * this stage (to avoid breaking the UI), but the warning provides
 * visibility for security monitoring.
 */
export async function verifyTemplatesWithBackend(): Promise<BackendIntegrityResult | null> {
  try {
    // Regenerate canonical content on demand (not cached — saves ~50MB heap)
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
    // Backend verification is defense-in-depth; don't break the app if unavailable
    logger.warn('Backend integrity verification unavailable', { err });
    return null;
  }
}

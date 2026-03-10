/**
 * Template Catalog — single source of truth for all template JSON files.
 *
 * Uses Vite glob import to eagerly load every JSON under scripts/templates/,
 * excluding debug directories. Also registers all built-in template IDs
 * for origin verification.
 */
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { computeContentHashSync, registerBuiltinTemplates } from '@/lib/templates/templateVerification';
import { TEMPLATE_CHECKSUMS } from './templateChecksums';

const modules = import.meta.glob<TemplateCatalogEntry>(
  [
    '../../../scripts/templates/**/*.json',
    '!../../../scripts/templates/_*/**',
  ],
  { eager: true, import: 'default' },
);

function templatePathFromModulePath(modulePath: string): string {
  const marker = '/scripts/templates/';
  const idx = modulePath.lastIndexOf(marker);
  if (idx === -1) return modulePath;
  return modulePath.slice(idx + marker.length);
}

const validTemplates: TemplateCatalogEntry[] = [];

for (const [modulePath, template] of Object.entries(modules)) {
  const relPath = templatePathFromModulePath(modulePath);
  const expectedChecksum = TEMPLATE_CHECKSUMS[relPath];

  if (!expectedChecksum) {
    console.warn(`[template-catalog] Missing checksum for built-in template: ${relPath}. Skipping.`);
    continue;
  }

  const actualChecksum = computeContentHashSync(JSON.stringify(template));
  if (actualChecksum !== expectedChecksum) {
    console.warn(`[template-catalog] Integrity mismatch for ${relPath}. Expected ${expectedChecksum}, got ${actualChecksum}. Skipping.`);
    continue;
  }

  validTemplates.push(template);
}

/** Every verified template in the catalog. */
export const TEMPLATE_CATALOG: TemplateCatalogEntry[] = validTemplates;

// Register all catalog templates as verified built-ins
registerBuiltinTemplates(TEMPLATE_CATALOG.map((t) => t.id));

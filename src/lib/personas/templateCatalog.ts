/**
 * Template Catalog — single source of truth for all template JSON files.
 *
 * Uses Vite glob import to eagerly load every JSON under scripts/templates/,
 * excluding debug directories. Also registers all built-in template IDs
 * for origin verification.
 */
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { registerBuiltinTemplates } from '@/lib/templates/templateVerification';

const modules = import.meta.glob<TemplateCatalogEntry>(
  [
    '../../../scripts/templates/**/*.json',
    '!../../../scripts/templates/_*/**',
  ],
  { eager: true, import: 'default' },
);

/** Every template in the catalog. */
export const TEMPLATE_CATALOG: TemplateCatalogEntry[] = Object.values(modules);

// Register all catalog templates as verified built-ins
registerBuiltinTemplates(TEMPLATE_CATALOG.map((t) => t.id));

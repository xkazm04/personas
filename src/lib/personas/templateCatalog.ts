/**
 * Template Catalog — single source of truth for all template JSON files.
 *
 * Uses Vite glob import to eagerly load every JSON under scripts/templates/,
 * excluding debug directories. Featured (builtin) templates are identified by
 * the `featured` flag in their JSON metadata.
 */
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';

const modules = import.meta.glob<TemplateCatalogEntry>(
  [
    '../../../scripts/templates/**/*.json',
    '!../../../scripts/templates/_*/**',
  ],
  { eager: true, import: 'default' },
);

/** Every template in the catalog (builtin + category). */
export const TEMPLATE_CATALOG: TemplateCatalogEntry[] = Object.values(modules);

/** Featured (builtin) templates — the curated starter set. */
export const FEATURED_TEMPLATES: TemplateCatalogEntry[] = TEMPLATE_CATALOG.filter(
  (t) => t.featured === true,
);

/** Non-featured (category) templates — everything else. */
export const CATEGORY_TEMPLATES: TemplateCatalogEntry[] = TEMPLATE_CATALOG.filter(
  (t) => !t.featured,
);

/**
 * Category Templates — bulk-imports all JSON template files from
 * scripts/templates/{category}/ subdirectories, excluding builtin/
 * and _debug/ directories.
 */
import type { BuiltinTemplate } from '@/lib/types/templateTypes';

const modules = import.meta.glob<BuiltinTemplate>(
  [
    '../../../scripts/templates/**/*.json',
    '!../../../scripts/templates/builtin/**',
    '!../../../scripts/templates/_*/**',
  ],
  { eager: true, import: 'default' },
);

export const CATEGORY_TEMPLATES: BuiltinTemplate[] = Object.values(modules);

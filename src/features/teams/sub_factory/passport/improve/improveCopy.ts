// The improve layer’s copy lives in `plugins.dev_tools.improve_*`. This is the
// string-valued key union of that section, so a constant can carry a KEY and the
// render site resolve it with `t.plugins.dev_tools[key]` (no English in a .ts module).
import type { Translations } from '@/i18n/useTranslation';

type DevTools = Translations['plugins']['dev_tools'];
export type DevToolsKey = { [K in keyof DevTools]: DevTools[K] extends string ? K : never }[keyof DevTools];

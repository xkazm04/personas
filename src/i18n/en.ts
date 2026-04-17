/**
 * Back-compat shim. The source of truth is now `src/i18n/locales/en.json`;
 * the `Translations` type is codegen'd to `src/i18n/generated/types.ts`.
 *
 * Keep the `en` and `Translations` named exports here so the ~30 modules
 * that `import { en, type Translations } from '@/i18n/en'` continue to
 * compile without per-file updates.
 *
 * To edit an English string: edit `src/i18n/locales/en.json`, then run
 * `node scripts/i18n/gen-types.mjs` (automatic in `npm run prebuild`).
 */

import enData from './locales/en.json';
import type { Translations as GeneratedTranslations } from './generated/types';

export const en = enData as GeneratedTranslations;
export type Translations = GeneratedTranslations;

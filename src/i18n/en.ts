/**
 * Back-compat shim. The source of truth is now `src/i18n/locales/en.json`;
 * the `Translations` type is codegen'd to `src/i18n/generated/types.ts`.
 *
 * Keep the `en` and `Translations` named exports here so the modules that
 * `import { en, type Translations } from '@/i18n/en'` continue to compile
 * without per-file updates.
 *
 * `en` is a `Proxy` that lazy-parses each top-level section on first access
 * (delegates to `getEnglishSection`). Module-init no longer parses all 57
 * sections up front — `import { en }` is now nearly free, and accessing
 * `en.alerts.x` only pays the parse cost for the `alerts` section.
 *
 * To edit an English string: edit `src/i18n/locales/en.json`, then run
 * `node scripts/i18n/gen-types.mjs` (automatic in `npm run prebuild`).
 *
 * Before adding a new key: read `src/i18n/CONTRACT.md`. This file is
 * Layer 4 of a four-layer contract (Rust codes → IPC → React → translators).
 * If you are about to add English prose for a Rust-side status or error,
 * the fix is almost always upstream — map the code, don't hardcode a sentence.
 */

import type { Translations as GeneratedTranslations } from './generated/types';
import {
  ALL_I18N_SECTIONS,
  getEnglishSection,
  isTranslationSection,
} from './englishSections';

export const en = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    if (typeof prop !== 'string' || !isTranslationSection(prop)) return undefined;
    return getEnglishSection(prop);
  },
  has(_target, prop) {
    return typeof prop === 'string' && isTranslationSection(prop);
  },
  ownKeys() {
    return ALL_I18N_SECTIONS;
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop === 'string' && isTranslationSection(prop)) {
      return { enumerable: true, configurable: true, value: getEnglishSection(prop) };
    }
    return undefined;
  },
}) as unknown as GeneratedTranslations;

export type Translations = GeneratedTranslations;

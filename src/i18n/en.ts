/**
 * Back-compat shim. The source of truth is now `src/i18n/locales/en.json`;
 * the `Translations` type is codegen'd to `src/i18n/generated/types.ts`.
 *
 * Keep the `en` and `Translations` named exports here so the modules that
 * `import { en, type Translations } from '@/i18n/en'` continue to compile
 * without per-file updates.
 *
 * `en` is a `Proxy` that delegates to `getEnglishSection` (englishSections.ts)
 * on first access to each top-level section. Only the ~25 "core" sections
 * (app-shell chrome + the always-mounted consent/remote-approval/monitor
 * surfaces + the sections this shim's ~19 real synchronous consumers
 * genuinely need in production — see `scripts/i18n/split-locales.mjs`'s
 * `EN_TS_SYNC_SECTIONS` for the audited list and its reasoning) are eagerly
 * bundled and parse-on-demand the way this comment used to describe for all
 * 62. Every other section — most of the catalog by byte weight — is now
 * code-split exactly like a non-English locale's sections
 * (`section-locales/en/<section>.json`, loaded by useTranslation.ts's
 * `import.meta.glob`), and useTranslation.ts kicks off a background load of
 * all of them the moment it's first imported (effectively at app boot). So
 * `import { en }` is still cheap, and the eager English payload this shim's
 * consumers are transitively responsible for dropped from ~1MB to ~500KB —
 * that used to be the full catalog regardless of which section any one
 * consumer touched, since a single statically-imported object literal can't
 * be partially tree-shaken by key.
 *
 * `en.section.key` still never returns a Promise. A CORE section is always
 * resolved. A non-core section that hasn't loaded yet is a real bug, not an
 * expected transient state — this shim has no render loop to self-heal on
 * the next listener broadcast the way `useTranslation()` does — so accessing
 * one throws in DEV (see the `get`/`getOwnPropertyDescriptor` traps below)
 * rather than silently handing back `undefined` two frames from a confusing
 * "Cannot read properties of undefined" one property access later. If you
 * hit this: either the section belongs in `EN_TS_SYNC_SECTIONS`, or this
 * call site should migrate to `useTranslation()` / `getActiveTranslations()`
 * instead of the `en` shim.
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
  type TranslationSection,
} from './englishSections';

function readSection(prop: TranslationSection): unknown {
  const value = getEnglishSection(prop);
  if (value === undefined && import.meta.env.DEV) {
    // A CORE section always resolves (see englishSections.ts), so reaching
    // here means a non-core section was read through this synchronous shim
    // before its background chunk landed — see this file's header. Thrown,
    // not warned: `en.ts` promises a complete snapshot, and a silent
    // `undefined` here just relocates the crash one property access later
    // with a far more confusing stack trace ("Cannot read properties of
    // undefined (reading '…')" pointing at the CALLER, not this shim).
    throw new Error(
      `[i18n] en.${prop} was read before its chunk loaded. "${prop}" is not in ` +
        `EN_TS_SYNC_SECTIONS (scripts/i18n/split-locales.mjs) — either add it there ` +
        `(if this is a genuine synchronous production need) or migrate this call site ` +
        `to useTranslation()/getActiveTranslations() instead of the "en" shim.`,
    );
  }
  return value;
}

export const en = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    if (typeof prop !== 'string' || !isTranslationSection(prop)) return undefined;
    return readSection(prop);
  },
  has(_target, prop) {
    return typeof prop === 'string' && isTranslationSection(prop);
  },
  ownKeys() {
    return ALL_I18N_SECTIONS;
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop === 'string' && isTranslationSection(prop)) {
      return { enumerable: true, configurable: true, value: readSection(prop) };
    }
    return undefined;
  },
}) as unknown as GeneratedTranslations;

export type Translations = GeneratedTranslations;

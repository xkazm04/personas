import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firstPaintKeys } from "./lib/first-paint-keys.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const localesDir = path.join(root, "src/i18n/locales");
const sectionDir = path.join(root, "src/i18n/section-locales");
const generatedDir = path.join(root, "src/i18n/generated");
const enPath = path.join(localesDir, "en.json");
const routeSectionsPath = path.join(root, "src/i18n/routeSections.ts");
const manifestPath = path.join(root, "src/i18n/locales.manifest.ts");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeIfChanged(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) {
    return;
  }
  fs.writeFileSync(file, content);
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  // Windows can hold transient locks on locale JSON files (AV scanner,
  // Search Indexer, recently-closed editor). A single fs.rmSync racing
  // against those crashes the dev server with EBUSY. Retry a few times
  // with backoff before giving up — the locks lift in well under a
  // second in practice.
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const transient = err && (err.code === "EBUSY" || err.code === "EPERM" || err.code === "ENOTEMPTY");
      if (!transient || isLast) throw err;
      // Synchronous backoff — codegen runs at startup, no event loop
      // pressure. 100/200/300/400/500ms across the 5 retries.
      const waitMs = 100 * attempt;
      const end = Date.now() + waitMs;
      while (Date.now() < end) { /* spin */ }
    }
  }
}

/**
 * Sections read SYNCHRONOUSLY through `en.ts`'s back-compat shim (the `en`
 * Proxy — `import { en } from '@/i18n/en'`), found by an explicit code audit
 * on 2026-08-30, NOT by a mechanical scan (a `t: Translations` parameter is
 * far too common a shape to grep for reliably — see the audit note below).
 *
 * `en.ts` cannot tolerate an async gap: its whole reason to exist is a value
 * that's ALWAYS a complete `Translations` object at module-init time. Some of
 * its ~19 real consumers (`import { en }` — not `import type { Translations }`,
 * which carries no runtime dependency at all and was the majority of what a
 * first pass over "77 files mention @/i18n/en" turned out to be) read a
 * section unconditionally in a genuine production path: a Zustand slice's
 * error toast (`tourSlice`/`alertSlice`/`executionSlice`/`chatSlice`), or a
 * module-top-level constant built from `en` at import time
 * (`evalFramework.ts`'s `STRATEGY_META`, `templateFeedback.ts`'s
 * `FEEDBACK_LABELS`, `EventConfigSubPanels.tsx`'s option array). THOSE are
 * what belong here.
 *
 * Others carry a `(t: Translations = en)` default that production never
 * actually exercises — every real call site passes a live `t` explicitly,
 * and the default only fires from a *test* calling the function with no
 * `t`, or handing it a test fixture built by aliasing `T = en as unknown as
 * Translations` (e.g. `modelCatalog.ts`'s `getAnthropicModels`/`getAllModels`
 * and `uiModes.ts`'s `getTierLabels` are dead code with zero callers at all,
 * production or test; `triggerConstants.ts`'s exports and
 * `glyph/cron.ts`+`glyph/triggers.ts`'s exports are called with an explicit
 * `t` everywhere in `src/`, and only their OWN test files ever pass `en`
 * directly). Bloating the eager core for a test's choice of fixture, when
 * production never takes that path, is the wrong trade — those tests were
 * fixed instead to await the chunk explicitly (see
 * `src/lib/utils/__tests__/triggerConstants.test.ts` and
 * `src/features/shared/glyph/__tests__/glyphPrimitives.test.ts`).
 *
 * This list is NOT provably exhaustive — a call graph this open-ended (any
 * function typed `Translations` can be handed `en`) has no static proof of
 * completeness short of a real type-flow analysis, out of scope here. It was
 * derived by grepping every file importing the `en` VALUE, reading each one,
 * and then widened/narrowed iteratively against real Vitest failures
 * (`npx vitest run --run`) until the suite was green with no test needing
 * an unjustified section. If a future change to one of the ~19 files starts
 * reading a genuinely-production section not listed here, the failure mode
 * is `getEnglishSection` returning `undefined` — loud in DEV (`en.ts`'s
 * proxy throws; see its `get` trap), not a silent wrong value, so a gap here
 * fails fast rather than shipping quietly.
 */
//
// 2026-10-25: `agents` (146 KB), `overview` (75 KB) and `vault` (84 KB) left
// this list - together 305 KB of the eager `en` chunk on the startup path.
// Their remaining `en.<section>` reads all run at call time, long after the
// idle background load lands every English section (chatSlice's
// execution-ended message, ChartErrorBoundary and importHelpers on routes
// whose sections are preloaded before mount); the one module-init read,
// EventConfigSubPanels' ROTATION_EVENT_TEMPLATES, became a function of `t`.
//
// `onboarding` (68 KB) left too, later the same day: its only boot-time reads
// were tourSlice's storage toast and two footer icons' labels, and those four
// keys moved to the core `chrome` section. The onboarding overlay itself loads
// the section before mount only while it can still appear (main.tsx).
const EN_TS_SYNC_SECTIONS = [
  "alerts", "deployment", "eval_strategies", "execution",
  "feedback_labels", "mastermind", "releases",
  "ship",
];

/**
 * The eager English "core" — CORE_SECTIONS below — is the union of:
 *  (a) `BASE_SECTIONS` from routeSections.ts: the app-shell chrome + the
 *      always-mounted surfaces (consent gate, remote-approval prompt, persona
 *      monitor) a first paint can never afford to await a chunk for. Extracted
 *      by regex, not hand-duplicated, so this file can't silently drift from
 *      what routeSections.ts actually preloads on every route.
 *  (b) `EN_TS_SYNC_SECTIONS` above: sections `en.ts`'s synchronous consumers
 *      need, found by the audit documented there.
 */
function readRouteBaseSections() {
  const src = fs.readFileSync(routeSectionsPath, "utf8");
  const match = /const BASE_SECTIONS: readonly TranslationSection\[\] = \[([\s\S]*?)\];/.exec(src);
  if (!match) {
    throw new Error(
      `split-locales: could not find "const BASE_SECTIONS: readonly TranslationSection[] = [...]" in ${routeSectionsPath} — ` +
        `the English eager-core list is partly extracted from it. Did the declaration change shape?`,
    );
  }
  const names = [...match[1].matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error("split-locales: BASE_SECTIONS parsed to zero names — matcher is broken, not the codebase clean.");
  }
  return names;
}

/**
 * FIRST_PAINT_PARTIAL_SECTIONS in routeSections.ts (2026-10-25): sections the
 * always-mounted chrome reads only a few keys of. Only those keys ship eagerly
 * (EN_PARTIAL_SECTION_STRINGS below); the full section is a lazy chunk.
 */
function readPartialSections() {
  const src = fs.readFileSync(routeSectionsPath, "utf8");
  const match = /export const FIRST_PAINT_PARTIAL_SECTIONS: readonly TranslationSection\[\] = \[([\s\S]*?)\];/.exec(src);
  if (!match) return [];
  return [...match[1].matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);
}

function readCoreSections() {
  return [...new Set([...readRouteBaseSections(), ...EN_TS_SYNC_SECTIONS])];
}

/**
 * The locales the app ships (`SHIPPED_UI_LOCALES` in locales.manifest.ts,
 * English only since 2026-10-25). Every locale is still split below - the
 * files stay in the repo and tests read them - but only these get a lazy
 * loader in generated/sectionLoaders.ts, so only these reach the bundle and
 * the Vitest import graph. Read by regex for the same reason as BASE_SECTIONS.
 */
function readShippedLocales() {
  const src = fs.readFileSync(manifestPath, "utf8");
  const match = /export const SHIPPED_UI_LOCALES: readonly LocaleCode\[\] = \[([^\]]*)\];/.exec(src);
  if (!match) {
    throw new Error(
      `split-locales: could not find "export const SHIPPED_UI_LOCALES: readonly LocaleCode[] = [...]" in ${manifestPath}.`,
    );
  }
  const codes = [...match[1].matchAll(/'([a-z]{2,3})'/g)].map((m) => m[1]);
  if (!codes.includes("en")) {
    throw new Error("split-locales: SHIPPED_UI_LOCALES must include 'en' - English is the fallback every read lands on.");
  }
  return codes;
}

const english = readJson(enPath);
const sectionNames = Object.keys(english);
const coreSections = readCoreSections();
const partialSections = readPartialSections();
for (const partial of partialSections) {
  if (coreSections.includes(partial)) {
    throw new Error(`split-locales: "${partial}" is both eager core and FIRST_PAINT_PARTIAL - remove it from BASE_SECTIONS / EN_TS_SYNC_SECTIONS.`);
  }
  if (!sectionNames.includes(partial)) {
    throw new Error(`split-locales: FIRST_PAINT_PARTIAL_SECTIONS names "${partial}", not a section of en.json.`);
  }
}
const { keys: partialKeys, closureSize } = firstPaintKeys(root, english, partialSections);
for (const core of coreSections) {
  if (!sectionNames.includes(core)) {
    throw new Error(`split-locales: BASE_SECTIONS names "${core}" which is not a top-level section of en.json.`);
  }
}
const localeFiles = fs
  .readdirSync(localesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

removeDir(sectionDir);

// Every locale — English included — gets a section-locales/<lang>/<section>.json
// file. English's are read through the SAME import.meta.glob('./section-locales/*/*.json')
// as the other 13 locales (src/i18n/useTranslation.ts); the 13 non-English
// locales additionally deep-merge over the matching English section so a
// translation lag never renders `undefined`.
for (const file of localeFiles) {
  const lang = file.replace(/\.json$/, "");
  const bundle = lang === "en" ? english : readJson(path.join(localesDir, file));
  for (const section of sectionNames) {
    const sectionJson = JSON.stringify(bundle[section] ?? {}, null, 2) + "\n";
    writeIfChanged(path.join(sectionDir, lang, `${section}.json`), sectionJson);
  }
}

// generated/enSectionStrings.ts holds two very different things:
//  - EN_ALL_SECTIONS: every section NAME (cheap — just strings), so
//    englishSections.ts can recognize/enumerate all 57 sections without
//    needing their content resident.
//  - EN_CORE_SECTION_STRINGS: the actual JSON content, but ONLY for the
//    ~13 core sections above (~100KB raw, not the ~1MB whole catalog). This
//    is the one piece of English content still allowed to be eager — every
//    other section reaches the runtime exclusively through the async
//    section-locales/en/<section>.json chunk written above.
const allSectionsLiteral = JSON.stringify(sectionNames);
const partialEntries = partialSections
  .map((section) => {
    const subset = Object.fromEntries(partialKeys[section].map((k) => [k, english[section][k]]));
    return `  ${JSON.stringify(section)}: ${JSON.stringify(JSON.stringify(subset))},`;
  })
  .join("\n");
const coreEntries = coreSections
  .map((section) => `  ${JSON.stringify(section)}: ${JSON.stringify(JSON.stringify(english[section] ?? {}))},`)
  .join("\n");

writeIfChanged(
  path.join(generatedDir, "enSectionStrings.ts"),
  `// AUTO-GENERATED FROM src/i18n/locales/en.json — DO NOT EDIT BY HAND.\n` +
    `// Regenerate with: node scripts/i18n/split-locales.mjs\n\n` +
    `// Every top-level section name (all ${sectionNames.length}). Cheap — names only, no content.\n` +
    `export const EN_ALL_SECTIONS = ${allSectionsLiteral} as const;\n\n` +
    `// Eager English "core" (~${coreSections.length} sections, extracted from routeSections.ts's\n` +
    `// BASE_SECTIONS): the only English content still resident in the main bundle.\n` +
    `// Every other section loads through section-locales/en/<section>.json — see\n` +
    `// src/i18n/englishSections.ts and src/i18n/useTranslation.ts.\n` +
    `export const EN_CORE_SECTION_STRINGS = {\n${coreEntries}\n} as const;\n\n` +
    `// Partial core (FIRST_PAINT_PARTIAL_SECTIONS in routeSections.ts): only the keys the static\n` +
    `// import closure of src/main.tsx can read before first paint\n` +
    `// (scripts/i18n/lib/first-paint-keys.mjs). The full section is a lazy chunk that replaces it.\n` +
    `export const EN_PARTIAL_SECTION_STRINGS: Partial<Record<string, string>> = {\n${partialEntries}\n};\n\n` +
    `export type I18nSectionKey = typeof EN_ALL_SECTIONS[number];\n` +
    `export type CoreI18nSectionKey = keyof typeof EN_CORE_SECTION_STRINGS;\n`,
);

// generated/sectionLoaders.ts: the lazy loaders, as an explicit list of files
// rather than the old './section-locales/*/*.json' glob. Two things leave the
// bundle this way:
//  - every locale outside SHIPPED_UI_LOCALES (27.5 MB of 41.9 MB of JS on
//    2026-10-25, and 952 of the files every Vitest `--changed` walk visited);
//  - English's core sections, which are already eager in enSectionStrings.ts
//    and so were never loaded through their chunk (`loadSection` returns on
//    the cached value first) - about 0.7 MB of dead duplicates across locales.
// Paths are relative to generated/, which is where import.meta.glob resolves them.
const shippedLocales = readShippedLocales();
const coreSet = new Set(coreSections);
const loaderPaths = [];
for (const lang of shippedLocales) {
  if (!localeFiles.includes(`${lang}.json`)) {
    throw new Error(`split-locales: SHIPPED_UI_LOCALES names "${lang}" but src/i18n/locales/${lang}.json does not exist.`);
  }
  for (const section of sectionNames) {
    if (lang === "en" && coreSet.has(section)) continue;
    loaderPaths.push(`../section-locales/${lang}/${section}.json`);
  }
}
writeIfChanged(
  path.join(generatedDir, "sectionLoaders.ts"),
  `// AUTO-GENERATED by scripts/i18n/split-locales.mjs — DO NOT EDIT BY HAND.\n` +
    `// Shipped UI locales: ${shippedLocales.join(", ")} (SHIPPED_UI_LOCALES in src/i18n/locales.manifest.ts).\n` +
    `// English core sections are absent on purpose: they are eager in enSectionStrings.ts.\n\n` +
    `export const sectionLoaders = import.meta.glob<{ default: unknown }>([\n` +
    loaderPaths.map((p) => `  ${JSON.stringify(p)},\n`).join("") +
    `]);\n`,
);

console.log(
  `Split ${localeFiles.length} locale(s) (English included) into ${sectionNames.length} section chunk(s); ` +
    `${coreSections.length} section(s) kept eager as the English core; ` +
    `partial core ${partialSections.map((s) => `${s} ${partialKeys[s].length}/${Object.keys(english[s]).length}`).join(", ") || "none"} ` +
    `(from a ${closureSize}-module startup closure); ` +
    `${loaderPaths.length} lazy loader(s) for shipped locale(s) ${shippedLocales.join(", ")}.`,
);

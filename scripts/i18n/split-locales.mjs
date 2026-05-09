import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const localesDir = path.join(root, "src/i18n/locales");
const sectionDir = path.join(root, "src/i18n/section-locales");
const generatedDir = path.join(root, "src/i18n/generated");
const enPath = path.join(localesDir, "en.json");

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

const english = readJson(enPath);
const sectionNames = Object.keys(english);
const localeFiles = fs
  .readdirSync(localesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

removeDir(sectionDir);

for (const file of localeFiles) {
  const lang = file.replace(/\.json$/, "");
  if (lang === "en") continue;
  const bundle = readJson(path.join(localesDir, file));
  for (const section of sectionNames) {
    const sectionJson = JSON.stringify(bundle[section] ?? {}, null, 2) + "\n";
    writeIfChanged(path.join(sectionDir, lang, `${section}.json`), sectionJson);
  }
}

const rawEntries = sectionNames
  .map((section) => `  ${JSON.stringify(section)}: ${JSON.stringify(JSON.stringify(english[section] ?? {}))},`)
  .join("\n");

writeIfChanged(
  path.join(generatedDir, "enSectionStrings.ts"),
  `// AUTO-GENERATED FROM src/i18n/locales/en.json — DO NOT EDIT BY HAND.\n` +
    `// Regenerate with: node scripts/i18n/split-locales.mjs\n\n` +
    `export const EN_SECTION_STRINGS = {\n${rawEntries}\n} as const;\n\n` +
    `export type I18nSectionKey = keyof typeof EN_SECTION_STRINGS;\n`,
);

console.log(`Split ${localeFiles.length} locale(s) into ${sectionNames.length} section chunk(s).`);

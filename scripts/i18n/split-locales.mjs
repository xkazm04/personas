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
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
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

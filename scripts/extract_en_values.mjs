import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const I18N_DIR = 'C:/Users/kazda/kiro/personas/src/i18n';

// Extract leaf key->value pairs from a TypeScript translation file
function extractKeyValues(filePath) {
  const src = readFileSync(filePath, "utf-8");
  const kvMap = {};
  const stack = [];
  let inExport = false;

  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) {
        inExport = true;
      }
      continue;
    }

    const dqRe = /"(?:[^"\\]|\\.)*"/g;
    const sqRe = /'(?:[^'\\]|\\.)*'/g;
    const bqRe = /`(?:[^`\\]|\\.)*`/g;
    const stripped = trimmed
      .replace(dqRe, '""')
      .replace(sqRe, "''")
      .replace(bqRe, '""');

    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    const netClose = closes - opens;

    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(":") + 1);

      if (afterColon.includes("{") && opens > closes) {
        stack.push(key);
      } else if (!afterColon.includes("{")) {
        // Leaf key - extract value
        const fullKey = [...stack, key].join(".");
        // Extract the string value
        const dqVal = trimmed.match(/:\s*"((?:[^"\\]|\\.)*)"/);
        if (dqVal) {
          kvMap[fullKey] = dqVal[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
        } else {
          const sqVal = trimmed.match(/:\s*'((?:[^'\\]|\\.)*)'/);
          if (sqVal) {
            kvMap[fullKey] = sqVal[1].replace(/\\'/g, "'");
          }
        }
      }
    }
    for (let i = 0; i < netClose && stack.length > 0; i++) {
      stack.pop();
    }

    if (stripped === "};" && stack.length === 0) break;
  }

  return kvMap;
}

const enKV = extractKeyValues(resolve(I18N_DIR, 'en.ts'));
const frParity = JSON.parse(readFileSync('C:/Users/kazda/AppData/Local/Temp/fr_parity.json', 'utf8'));
const missingKeys = frParity.locales[0].missingKeys;

const missing = {};
for (const key of missingKeys) {
  missing[key] = enKV[key] !== undefined ? enKV[key] : null;
}

writeFileSync('C:/Users/kazda/AppData/Local/Temp/en_missing_for_fr.json', JSON.stringify(missing, null, 2));
console.log('Extracted ' + Object.keys(missing).length + ' keys');
const sample = Object.entries(missing).slice(0, 5);
for (const [k, v] of sample) {
  console.log(`  ${k}: "${v}"`);
}

#!/usr/bin/env node
/**
 * translate-locales.mjs
 *
 * Fills missing translation keys across all 12 locale .ts files using Claude claude-sonnet-4-6.
 * Sends batches of English strings and gets translations for all languages simultaneously.
 *
 * Prerequisites:
 *   ANTHROPIC_API_KEY must be set in environment
 *   @anthropic-ai/sdk must be installed (npm install @anthropic-ai/sdk)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/translate-locales.mjs
 *
 * Options:
 *   --lang CODES        Comma-separated language codes (default: all 12)
 *   --batch-size N      Keys per API call (default: 75)
 *   --concurrency N     Parallel API calls (default: 4)
 *   --dry-run           Don't write files, show counts only
 *   --checkpoint FILE   Checkpoint path (default: .translate-progress.json)
 *   --resume            Skip batches already in checkpoint
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const I18N_DIR = resolve(ROOT, 'src/i18n');
const EN_PATH = resolve(I18N_DIR, 'en.ts');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : def;
};
const hasFlag = (flag) => args.includes(flag);

const ALL_LANGS = ['ar', 'bn', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];
const LANG_NAMES = {
  ar: 'Arabic', bn: 'Bengali', cs: 'Czech', de: 'German',
  es: 'Spanish (international)', fr: 'French (international)', hi: 'Hindi',
  id: 'Indonesian (Bahasa Indonesia)', ja: 'Japanese', ko: 'Korean',
  ru: 'Russian', vi: 'Vietnamese', zh: 'Simplified Chinese (Mandarin)',
};

const langArg = getArg('--lang', null);
const TARGET_LANGS = langArg ? langArg.split(',').map(l => l.trim()) : ALL_LANGS;
const BATCH_SIZE = parseInt(getArg('--batch-size', '75'), 10);
const CONCURRENCY = parseInt(getArg('--concurrency', '4'), 10);
const DRY_RUN = hasFlag('--dry-run');
const CHECKPOINT = getArg('--checkpoint', resolve(ROOT, '.translate-progress.json'));
const RESUME = hasFlag('--resume');

// ---------------------------------------------------------------------------
// API key check
// ---------------------------------------------------------------------------
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY && !DRY_RUN) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
  console.error('Set it with: export ANTHROPIC_API_KEY=sk-ant-...');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Shared: parse a .ts locale file → Map<dottedKey, value>
// ---------------------------------------------------------------------------
function parseLocaleFile(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const map = new Map();
  const stack = [];
  let inExport = false;

  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') ||
        trimmed.startsWith('/*') || trimmed.startsWith('*/')) continue;

    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) inExport = true;
      continue;
    }

    const stripped = trimmed
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(':') + 1);
      const hasOpen = afterColon.includes('{');
      const hasClose = afterColon.includes('}');
      if (hasOpen && hasClose) {
        const openIdx = trimmed.indexOf('{');
        const closeIdx = trimmed.lastIndexOf('}');
        const inner = trimmed.slice(openIdx + 1, closeIdx);
        const innerRe = /(?:"([\w$-]+)"|(\w[\w$]*))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = innerRe.exec(inner)) !== null) {
          const innerKey = m[1] ?? m[2];
          map.set([...stack, key, innerKey].join('.'), m[3]);
        }
      } else if (hasOpen) {
        stack.push(key);
      } else {
        const valMatch = trimmed.match(/:\s*"((?:[^"\\]|\\.)*)"/) ||
                         trimmed.match(/:\s*'((?:[^'\\]|\\.)*)'/);
        if (valMatch) {
          map.set([...stack, key].join('.'), valMatch[1]);
        }
      }
    }

    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    for (let i = 0; i < closes - opens && stack.length > 0; i++) stack.pop();
    if (stripped === '};' && stack.length === 0) break;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Parse en.ts → ordered list of events (for structure-preserving output)
// ---------------------------------------------------------------------------
function parseEnStructure(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const events = [];
  const stack = [];
  let inExport = false;

  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') ||
        trimmed.startsWith('/*') || trimmed.startsWith('*/')) continue;

    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) inExport = true;
      continue;
    }

    const stripped = trimmed
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(':') + 1);
      const hasOpen = afterColon.includes('{');
      const hasClose = afterColon.includes('}');
      if (hasOpen && hasClose) {
        // Inline object: parse inner key/value pairs
        const openIdx = trimmed.indexOf('{');
        const closeIdx = trimmed.lastIndexOf('}');
        const inner = trimmed.slice(openIdx + 1, closeIdx);
        const innerRe = /(?:"([\w$-]+)"|(\w[\w$]*))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = innerRe.exec(inner)) !== null) {
          const innerKey = m[1] ?? m[2];
          const innerVal = m[3];
          events.push({ type: 'leaf', key: innerKey, path: [...stack, key, innerKey], enVal: innerVal });
        }
      } else if (hasOpen) {
        stack.push(key);
        events.push({ type: 'open', key, path: [...stack] });
      } else {
        const valMatch = trimmed.match(/:\s*"((?:[^"\\]|\\.)*)"/) ||
                         trimmed.match(/:\s*'((?:[^'\\]|\\.)*)'/);
        const val = valMatch ? valMatch[1] : '';
        events.push({ type: 'leaf', key, path: [...stack, key], enVal: val });
      }
    }

    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    for (let i = 0; i < closes - opens && stack.length > 0; i++) {
      const closedKey = stack.pop();
      events.push({ type: 'close', key: closedKey, path: [...stack] });
    }
    if (stripped === '};' && stack.length === 0) break;
  }
  return events;
}

// ---------------------------------------------------------------------------
// TypeScript serializer (preserves nested structure, quotes keys with hyphens)
// ---------------------------------------------------------------------------
function needsQuotes(key) { return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key); }
function tsKey(key)       { return needsQuotes(key) ? `"${key}"` : key; }
function escapeStr(val)   { return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

// Append extra keys (those in mergedTranslations but NOT in en.ts) into their nearest section
function appendExtras(output, mergedTranslations, enLeafKeySet) {
  const extras = new Map();
  for (const [dottedKey, val] of mergedTranslations) {
    if (!enLeafKeySet.has(dottedKey)) {
      const parts = dottedKey.split('.');
      const section = parts[0];
      if (!extras.has(section)) extras.set(section, []);
      extras.get(section).push({ parts, val });
    }
  }
  if (extras.size === 0) return output;

  let result = output;
  for (const [section, items] of extras) {
    const sectionHeaderRe = new RegExp(`^  (?:"${section}"|${section}): \\{$`, 'm');
    const match = sectionHeaderRe.exec(result);
    if (!match) continue;
    let depth = 0, closePos = -1, idx = match.index;
    while (idx < result.length) {
      if (result[idx] === '{') depth++;
      else if (result[idx] === '}') {
        depth--;
        if (depth === 0) { closePos = idx; break; }
      }
      idx++;
    }
    if (closePos === -1) continue;
    const extraLines = items.map(({ parts, val }) => {
      const indent = '  '.repeat(parts.length);
      return `${indent}${tsKey(parts[parts.length - 1])}: "${escapeStr(val)}",`;
    }).join('\n');
    const lineStart = result.lastIndexOf('\n', closePos - 1) + 1;
    result = result.slice(0, lineStart) + extraLines + '\n' + result.slice(lineStart);
  }
  return result;
}

function generateLocaleFile(langCode, mergedTranslations, enEvents) {
  // Build set of en.ts leaf keys
  const enLeafKeys = new Set();
  for (const e of enEvents) {
    if (e.type === 'leaf') enLeafKeys.add(e.path.join('.'));
  }

  // Group extras (in mergedTranslations but NOT in en.ts) by parent path
  const extrasByParent = new Map();
  for (const [dottedKey, val] of mergedTranslations) {
    if (enLeafKeys.has(dottedKey)) continue;
    const parts = dottedKey.split('.');
    if (parts.length < 2) continue;
    const parent = parts.slice(0, -1).join('.');
    const key = parts[parts.length - 1];
    if (!extrasByParent.has(parent)) extrasByParent.set(parent, []);
    extrasByParent.get(parent).push({ key, val, depth: parts.length });
  }

  // Forward pass: which sections (full dotted paths) have content?
  const hasContent = new Set();
  function markAncestors(parts) {
    for (let i = 1; i <= parts.length; i++) hasContent.add(parts.slice(0, i).join('.'));
  }
  for (const e of enEvents) {
    if (e.type === 'leaf' && mergedTranslations.has(e.path.join('.'))) {
      markAncestors(e.path.slice(0, -1));
    }
  }
  for (const parent of extrasByParent.keys()) {
    if (parent) markAncestors(parent.split('.'));
  }

  // Emit pass
  const lines = [`export const ${langCode} = {`, ''];
  const emittedExtras = new Set();

  for (const event of enEvents) {
    if (event.type === 'open') {
      const dotted = event.path.join('.');
      if (hasContent.has(dotted)) {
        const indent = '  '.repeat(event.path.length);
        lines.push(`${indent}${tsKey(event.key)}: {`);
      }
    } else if (event.type === 'leaf') {
      const dotted = event.path.join('.');
      if (mergedTranslations.has(dotted)) {
        const indent = '  '.repeat(event.path.length);
        lines.push(`${indent}${tsKey(event.key)}: "${escapeStr(mergedTranslations.get(dotted))}",`);
      }
    } else if (event.type === 'close') {
      const dotted = [...event.path, event.key].join('.');
      if (hasContent.has(dotted)) {
        if (extrasByParent.has(dotted) && !emittedExtras.has(dotted)) {
          emittedExtras.add(dotted);
          for (const x of extrasByParent.get(dotted)) {
            const xIndent = '  '.repeat(x.depth);
            lines.push(`${xIndent}${tsKey(x.key)}: "${escapeStr(x.val)}",`);
          }
        }
        const indent = '  '.repeat(event.path.length + 1);
        lines.push(`${indent}},`);
      }
    }
  }
  lines.push('};', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Translation via Claude API
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a professional software localization expert specializing in desktop application UI. Translate UI strings precisely and concisely.`;

function buildUserPrompt(batchKV, targetLangs) {
  const langList = targetLangs.map(l => `- ${l}: ${LANG_NAMES[l]}`).join('\n');
  const inputJson = JSON.stringify(batchKV, null, 2);

  return `Translate these English UI strings from a desktop AI agent management application.

Target languages:
${langList}

STRICT RULES:
1. Preserve {variable} placeholders EXACTLY as-is (e.g., {count}, {name}, {seconds}, {attempt}, {error})
2. DO NOT translate: brand names (Claude, OAuth, GitHub, Slack, Anthropic, Personas, Sentry, GitLab, LiteLLM, Ollama, Gemini, OpenAI), technical terms (API, CLI, JSON, HTTPS, cron, webhook, SQLite, AES-256, URL, SLA, BYOM, n8n)
3. Keep UI labels CONCISE — buttons, badges, and menu items have limited space
4. "Agent" and "Persona" mean an AI bot the user has configured — translate consistently
5. "Credential" / "Key" = an API key or authentication token — translate consistently
6. "Vault" = secure credential storage — translate consistently
7. "Trigger" = event that starts an agent run — translate consistently
8. "Connector" = integration bridge to external service — translate consistently
9. Return ONLY valid JSON, no markdown fences, no explanation

English strings to translate (key → value):
${inputJson}

Return JSON with EXACTLY this structure (all ${targetLangs.length} language codes as top-level keys):
{
${targetLangs.map(l => `  "${l}": { "key": "translation", ... }`).join(',\n')}
}`;
}

async function translateBatch(client, batchKV, targetLangs, attempt = 1) {
  const prompt = buildUserPrompt(batchKV, targetLangs);
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
      system: SYSTEM_PROMPT,
    });

    const text = msg.content[0]?.text ?? '';
    // Extract JSON from response (handle potential leading/trailing text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    if (attempt < 3) {
      const wait = attempt * 5000;
      console.warn(`  ⚠  Attempt ${attempt} failed: ${err.message}. Retrying in ${wait/1000}s...`);
      await new Promise(r => setTimeout(r, wait));
      return translateBatch(client, batchKV, targetLangs, attempt + 1);
    }
    console.error(`  ✗ Batch failed after 3 attempts: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------
async function withConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== translate-locales.mjs ===`);
  console.log(`Languages: ${TARGET_LANGS.join(', ')}`);
  console.log(`Batch size: ${BATCH_SIZE}  Concurrency: ${CONCURRENCY}`);
  if (DRY_RUN) console.log('DRY RUN — no files will be written\n');

  // Load checkpoint if resuming
  let checkpoint = {};
  if (RESUME && existsSync(CHECKPOINT)) {
    checkpoint = JSON.parse(readFileSync(CHECKPOINT, 'utf-8'));
    console.log(`Loaded checkpoint with ${Object.keys(checkpoint).length} completed batches`);
  }

  // Parse en.ts
  console.log('\nParsing en.ts...');
  const enEvents = parseEnStructure(EN_PATH);
  const enKeyValues = new Map();
  const enLeafKeySet = new Set();
  for (const e of enEvents) {
    if (e.type === 'leaf') {
      enKeyValues.set(e.path.join('.'), e.enVal);
      enLeafKeySet.add(e.path.join('.'));
    }
  }
  console.log(`  ${enKeyValues.size} total keys in en.ts`);

  // Parse existing locale files
  console.log('\nParsing existing locale files...');
  const existingPerLang = {};
  for (const lang of TARGET_LANGS) {
    const localePath = resolve(I18N_DIR, `${lang}.ts`);
    existingPerLang[lang] = existsSync(localePath) ? parseLocaleFile(localePath) : new Map();
    console.log(`  ${lang}: ${existingPerLang[lang].size} existing keys`);
  }

  // Find globally missing keys (keys missing from at least one target language)
  // Since all locales have roughly the same coverage, use union of missing sets
  const missingKeysSet = new Set();
  for (const lang of TARGET_LANGS) {
    for (const key of enKeyValues.keys()) {
      if (!existingPerLang[lang].has(key)) missingKeysSet.add(key);
    }
  }
  const missingKeys = [...missingKeysSet];
  console.log(`\n${missingKeys.length} unique keys need translation across target languages`);

  if (missingKeys.length === 0) {
    console.log('Nothing to do — all locales are up to date!');
    return;
  }

  if (DRY_RUN) {
    for (const lang of TARGET_LANGS) {
      const missing = missingKeys.filter(k => !existingPerLang[lang].has(k));
      console.log(`  ${lang}: would translate ${missing.length} keys`);
    }
    return;
  }

  // Create Anthropic client
  const client = new Anthropic({ apiKey: API_KEY });

  // Build batches
  const batches = [];
  for (let i = 0; i < missingKeys.length; i += BATCH_SIZE) {
    batches.push(missingKeys.slice(i, i + BATCH_SIZE));
  }
  console.log(`\nSplit into ${batches.length} batches of up to ${BATCH_SIZE} keys each`);

  // Accumulate translations per language
  const accumulatedPerLang = {};
  for (const lang of TARGET_LANGS) accumulatedPerLang[lang] = new Map();

  // Load accumulated data from checkpoint
  if (RESUME && checkpoint.accumulated) {
    for (const [lang, entries] of Object.entries(checkpoint.accumulated)) {
      if (accumulatedPerLang[lang]) {
        for (const [k, v] of Object.entries(entries)) {
          accumulatedPerLang[lang].set(k, v);
        }
      }
    }
    console.log(`Restored accumulated translations from checkpoint`);
  }

  // Translate batches with concurrency
  let completed = checkpoint.completedBatches ?? 0;
  let failed = 0;

  const batchTasks = batches.map((batch, batchIdx) => async () => {
    const batchId = `batch-${batchIdx}`;

    // Skip if already completed
    if (RESUME && checkpoint[batchId]) {
      process.stdout.write('.');
      return;
    }

    // Build key/value object for this batch
    const batchKV = {};
    for (const key of batch) batchKV[key] = enKeyValues.get(key) || '';

    // Determine which languages still need this batch
    const langsNeeding = TARGET_LANGS.filter(lang =>
      batch.some(k => !existingPerLang[lang].has(k))
    );
    if (langsNeeding.length === 0) { process.stdout.write('.'); return; }

    const result = await translateBatch(client, batchKV, langsNeeding);
    if (!result) { failed++; process.stdout.write('✗'); return; }

    // Store results
    for (const lang of langsNeeding) {
      const langResult = result[lang] || {};
      for (const [key, val] of Object.entries(langResult)) {
        if (val && typeof val === 'string') {
          accumulatedPerLang[lang].set(key, val);
        }
      }
    }

    completed++;
    process.stdout.write(`${batchIdx % 10 === 9 ? `|${completed}` : '█'}`);

    // Save checkpoint periodically
    if (completed % 10 === 0) {
      const checkpointData = { completedBatches: completed, [batchId]: true, accumulated: {} };
      for (const [lang, map] of Object.entries(accumulatedPerLang)) {
        checkpointData.accumulated[lang] = Object.fromEntries(map);
      }
      // Mark all completed batches
      for (let k = 0; k < batchIdx; k++) {
        checkpointData[`batch-${k}`] = true;
      }
      writeFileSync(CHECKPOINT, JSON.stringify(checkpointData), 'utf-8');
    }
  });

  console.log('\nTranslating (█ = batch complete, | = 10 batches):');
  await withConcurrency(batchTasks, CONCURRENCY);
  console.log(`\n\nCompleted: ${completed} batches, Failed: ${failed}`);

  // Generate and write locale files
  console.log('\nWriting locale files...');
  for (const lang of TARGET_LANGS) {
    const merged = new Map([...existingPerLang[lang], ...accumulatedPerLang[lang]]);
    const newKeys = [...accumulatedPerLang[lang].keys()].filter(k => !existingPerLang[lang].has(k));

    if (newKeys.length === 0) {
      console.log(`  ${lang}: no new translations, skipping`);
      continue;
    }

    const tsContent = generateLocaleFile(lang, merged, enEvents);
    const outPath = resolve(I18N_DIR, `${lang}.ts`);
    writeFileSync(outPath, tsContent, 'utf-8');
    console.log(`  ${lang}: wrote ${merged.size} translations (+${newKeys.length} new) → ${outPath}`);
  }

  // Clean up checkpoint on success
  if (failed === 0 && existsSync(CHECKPOINT)) {
    try { unlinkSync(CHECKPOINT); } catch {}
  }

  console.log('\nDone! Run: node scripts/check-locale-parity.mjs');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

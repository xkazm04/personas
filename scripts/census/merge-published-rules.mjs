// Merge the census rule(s) a golden path publishes in its §9 into rules.json.
//
// Composers are told NOT to edit rules.json — a dozen agents writing to one
// registry concurrently is how you lose a rule. Instead each publishes a fenced
// ```json block shaped {"rules":[...]}, and the parent merges it here.
//
// This exists because the parent hand-rolled the extraction five times and got
// it wrong once: an extractor that assumed one rule per block silently merged
// ZERO when a composer published {"rules":[a,b]}, and the census reported the
// same 16 rules as before — a no-op that looks exactly like success. 217 leaves
// remain, so this happens 217 more times.
//
// Usage: node scripts/census/merge-published-rules.mjs <path-to-golden-path.md>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/mkdol/dolla/personas';
const RULES = path.join(ROOT, 'scripts/census/rules.json');

const doc = process.argv[2];
if (!doc) {
  console.error('usage: merge-published-rules.mjs <golden-path.md>');
  process.exit(2);
}
const docPath = path.isAbsolute(doc) ? doc : path.join(ROOT, doc);
if (!fs.existsSync(docPath)) {
  console.error(`FATAL: ${docPath} does not exist`);
  process.exit(2);
}

const src = fs.readFileSync(docPath, 'utf8');
const blocks = [...src.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map((m) => m[1]);
if (blocks.length === 0) {
  console.error('FATAL: no ```json block in this path. A path that gates nothing must say so in prose;');
  console.error('a path that gates something must publish the rule. Neither is true here.');
  process.exit(2);
}

// Accept every shape a composer might reasonably publish, rather than failing
// on a formatting choice: {"rules":[...]} | [...] | {...}. Anything without an
// `id` is prose-illustrative JSON (an example config, a sample payload) and is
// skipped loudly rather than silently.
const incoming = [];
for (const b of blocks) {
  let parsed;
  try { parsed = JSON.parse(b); } catch { continue; }
  const candidates = Array.isArray(parsed) ? parsed : (parsed.rules ?? [parsed]);
  for (const c of candidates) {
    if (c && typeof c === 'object' && c.id) incoming.push(c);
    else console.warn(`  (skipped a json block with no "id" — assumed illustrative)`);
  }
}
if (incoming.length === 0) {
  console.error('FATAL: parsed json blocks but none carried an "id". Nothing merged.');
  process.exit(2);
}

const registry = JSON.parse(fs.readFileSync(RULES, 'utf8'));
const before = registry.rules.length;
const existing = new Set(registry.rules.map((r) => r.id));

let merged = 0;
for (const r of incoming) {
  if (existing.has(r.id)) { console.log(`  = ${r.id} already present, skipped`); continue; }
  // A rule whose goldenPath does not point back at the doc that published it
  // will pass the census and fail corpus integrity later, confusingly.
  const rel = path.relative(ROOT, docPath).split(path.sep).join('/');
  if (r.goldenPath && r.goldenPath !== rel) {
    console.warn(`  ! ${r.id} declares goldenPath "${r.goldenPath}" but was published by "${rel}"`);
  }
  if (!r.goldenPath) r.goldenPath = rel;
  registry.rules.push(r);
  existing.add(r.id);
  merged++;
  console.log(`  + ${r.id}  baseline ${JSON.stringify(r.baseline)}  floor ${r.floor}`);
}

if (merged === 0) {
  console.log(`nothing to merge (${before} rules unchanged)`);
  process.exit(0);
}

fs.writeFileSync(RULES, JSON.stringify(registry, null, 2) + '\n');
console.log(`merged ${merged} rule(s): ${before} -> ${registry.rules.length}`);
console.log('now run: npm run census   (baselines must reproduce EXACTLY)');

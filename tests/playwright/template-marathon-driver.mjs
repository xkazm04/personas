#!/usr/bin/env node
/**
 * Template marathon — Node driver.
 *
 * Picks the next un-attempted (or previously-failed, with --resume)
 * template, shells out to `npx playwright test template-marathon.spec.ts`
 * with TEMPLATE_ID env var, reads the per-template result JSON, and
 * decides what to do next:
 *   - pass: continue
 *   - soft-fail: log and continue
 *   - hard-fail: match signature → known-fix? apply + retry once : pause
 *   - app crash: warm-restart guidance + pause
 *
 * Usage:
 *   node tests/playwright/template-marathon-driver.mjs            # fresh run
 *   node tests/playwright/template-marathon-driver.mjs --resume   # skip passed
 *   node tests/playwright/template-marathon-driver.mjs --target 10  # subset
 *   node tests/playwright/template-marathon-driver.mjs --only foo,bar  # specific
 *
 * State file: tests/results/marathon-state.json (resumable index).
 * Per-template results: tests/results/marathon/<id>.json
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const STATE_FILE = join(REPO_ROOT, 'tests', 'results', 'marathon-state.json');
const RESULTS_DIR = join(REPO_ROOT, 'tests', 'results', 'marathon');

const args = process.argv.slice(2);
const argFlag = (name) => args.includes(name);
const argValue = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 && idx < args.length - 1 ? args[idx + 1] : null;
};

const RESUME = argFlag('--resume');
const TARGET = argValue('--target') ? Number(argValue('--target')) : 50;
const ONLY = argValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const PAUSE_ON_FAIL = !argFlag('--continue-on-fail'); // default: pause

// --- State helpers ---

function readState() {
  if (!existsSync(STATE_FILE)) {
    return { started_at: new Date().toISOString(), templates_attempted: [], bugs_observed: [] };
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  if (!existsSync(dirname(STATE_FILE))) mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readTemplateResult(templateId) {
  const p = join(RESULTS_DIR, `${templateId}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

// --- Template inventory ---

async function loadTargets() {
  // Run the TS fixtures via a tiny inline helper that ts-node can pick
  // up, OR just inline the logic here in JS. Simpler: call into the
  // bridge to read the vault, then load template paths via fs.
  // We replicate the fixtures' selection logic here to avoid a tsx
  // dependency in the driver.
  const { readdirSync, statSync } = await import('node:fs');
  const templatesDir = join(REPO_ROOT, 'scripts', 'templates');
  const all = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('_')) continue;
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (entry.endsWith('.json') && !/\.(ar|bn|cs|de|es|fr|hi|id|ja|ko|ru|vi|zh)\.json$/i.test(entry)) {
        all.push(p);
      }
    }
  }
  walk(templatesDir);

  const VAULT = new Set([
    'airtable', 'alpha_vantage', 'asana', 'attio', 'betterstack',
    'cal_com', 'clickup', 'desktop_docker', 'elevenlabs', 'gmail',
    'github', 'google_calendar', 'leonardo_ai', 'linear', 'local_drive',
    'notion', 'personas_database', 'personas_messages', 'personas_vector_db',
    'sentry', 'supabase',
  ]);
  const BUILTIN = new Set(['local_drive', 'personas_database', 'personas_messages', 'personas_vector_db', 'codebase', 'desktop_terminal', 'desktop_browser', 'desktop']);
  const CATEGORY_HINTS = {
    email: ['gmail'], messaging: ['personas_messages'], image_generation: ['leonardo_ai'],
    crm: ['attio'], knowledge_base: ['notion'], calendar: ['google_calendar'],
    task_tracker: ['asana', 'linear', 'clickup'], ticketing: ['linear', 'asana'],
    source_control: ['github'], observability: ['sentry'], scheduling: ['cal_com'],
  };

  const out = [];
  for (const f of all) {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      if (!j.id || !j.name) continue;
      const conns = (j.payload?.persona?.connectors ?? []).filter((c) => c.required !== false);
      const missing = [];
      for (const c of conns) {
        const name = (c.name ?? '').toLowerCase();
        if (BUILTIN.has(name)) continue;
        const candidates = [c.name, c.role, c.category, ...(CATEGORY_HINTS[(c.category ?? '').toLowerCase()] ?? [])].filter(Boolean).map((s) => s.toLowerCase());
        if (!candidates.some((s) => VAULT.has(s))) missing.push(c.name ?? c.category ?? '?');
      }
      if (missing.length > 0) continue;
      out.push({
        id: j.id, name: j.name,
        category: ((j.category ?? ['other'])[0] ?? 'other').toLowerCase(),
        capabilityCount: (j.payload?.use_cases ?? []).length,
      });
    } catch { /* skip */ }
  }
  // Sort: category, capCount, id — stable across runs
  out.sort((a, b) => a.category.localeCompare(b.category) || a.capabilityCount - b.capabilityCount || a.id.localeCompare(b.id));
  return out;
}

// --- Health gate ---

async function checkAppHealth() {
  try {
    const port = process.env.COMPANION_TEST_PORT ?? '17320';
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.status !== 'ok') throw new Error(`status=${j.status}`);
    return true;
  } catch (e) {
    return false;
  }
}

// --- Spec invocation ---

function runSpecForTemplate(templateId) {
  return new Promise((resolve) => {
    const env = { ...process.env, TEMPLATE_ID: templateId };
    const child = spawn('npx', ['playwright', 'test', 'template-marathon.spec.ts', '--reporter=line'], {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => resolve({ exitCode: code ?? 1 }));
  });
}

// --- Signature matcher (auto-fix decisions) ---

const KNOWN_SIGNATURES = [
  // Pattern: substring of failure_signature → action.
  // 'skip' = log + continue. 'retry' = re-run once. 'pause' = stop marathon.
  { match: 'phase:open:template-card-not-found', action: 'retry', detail: 'Template card lookup occasionally races the list render. Retry-once is the spec-line response.' },
  { match: 'phase:build:awaiting_input', action: 'skip', detail: 'Build asked an unanswerable follow-up; spec already loops up to 60 turns. Skipping the template — surface in the post-mortem.' },
  { match: 'phase:execute:execution-timeout', action: 'skip', detail: 'External API rate-limit or slow tool. Continue with next template.' },
  { match: 'phase:verify:empty-execution', action: 'skip', detail: 'Completed but no tool_steps — known soft-fail; log without halting.' },
];

function matchSignature(signature) {
  if (!signature) return null;
  return KNOWN_SIGNATURES.find((s) => signature.includes(s.match)) ?? null;
}

// --- Main loop ---

async function main() {
  console.log('Template marathon driver — starting');
  const targets = await loadTargets();
  const selection = ONLY ? targets.filter((t) => ONLY.includes(t.id)) : targets.slice(0, TARGET);
  console.log(`Selected ${selection.length} templates (target=${TARGET}, only=${ONLY?.join(',') ?? '∅'})`);

  if (!(await checkAppHealth())) {
    console.error('❌ App not reachable at /health. Start `npm run tauri:dev:test` and re-run.');
    process.exit(2);
  }

  const state = readState();
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

  const skipPassed = (id) => {
    if (!RESUME) return false;
    const r = readTemplateResult(id);
    return r && r.outcome === 'pass';
  };

  let attempted = 0;
  let passed = 0;
  let failed = 0;
  let paused = false;

  for (const target of selection) {
    if (skipPassed(target.id)) {
      console.log(`⏭  ${target.id} — already passed, skipping`);
      passed += 1;
      continue;
    }

    if (!(await checkAppHealth())) {
      console.error(`❌ App health check failed before ${target.id}. Pausing — restart the app + re-run with --resume.`);
      paused = true;
      break;
    }

    attempted += 1;
    console.log(`\n=== [${attempted}/${selection.length}] ${target.id} (${target.category}, ${target.capabilityCount} cap${target.capabilityCount === 1 ? '' : 's'}) ===`);

    let result = null;
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      const { exitCode } = await runSpecForTemplate(target.id);
      result = readTemplateResult(target.id);
      if (!result) {
        console.error(`  ⚠ no result file written; spec exited ${exitCode}. Treating as hard-fail with signature spec-crash.`);
        result = { template_id: target.id, outcome: 'hard-fail', failure_signature: `spec-crash:exit=${exitCode}` };
      }
      if (result.outcome === 'pass') break;
      const sig = matchSignature(result.failure_signature);
      if (sig?.action === 'retry' && attempt < 2) {
        console.log(`  ↻ Retry signature match: ${sig.match} — ${sig.detail}`);
        continue;
      }
      break;
    }

    if (result.outcome === 'pass') {
      passed += 1;
      console.log(`  ✓ pass`);
    } else if (result.outcome === 'soft-fail') {
      failed += 1;
      console.log(`  ⚠ soft-fail: ${result.failure_signature ?? '?'}`);
    } else {
      const sig = matchSignature(result.failure_signature);
      if (sig?.action === 'skip') {
        failed += 1;
        console.log(`  ⊝ hard-fail, but signature matches skip: ${sig.match}`);
        state.bugs_observed.push({ template_id: target.id, signature: result.failure_signature, action: 'skipped', detail: sig.detail });
      } else if (PAUSE_ON_FAIL) {
        failed += 1;
        console.error(`  ✗ hard-fail with no auto-skip signature: ${result.failure_signature}`);
        console.error(`  → Marathon paused. Triage tests/results/marathon/${target.id}.json, fix, then re-run with --resume.`);
        state.bugs_observed.push({ template_id: target.id, signature: result.failure_signature, action: 'paused-for-triage' });
        paused = true;
        break;
      } else {
        failed += 1;
        console.error(`  ✗ hard-fail: ${result.failure_signature} (continuing per --continue-on-fail)`);
        state.bugs_observed.push({ template_id: target.id, signature: result.failure_signature, action: 'logged' });
      }
    }

    if (!state.templates_attempted.includes(target.id)) state.templates_attempted.push(target.id);
    writeState(state);
  }

  console.log(`\n=== Marathon ${paused ? 'PAUSED' : 'COMPLETE'} ===`);
  console.log(`  Attempted: ${attempted}`);
  console.log(`  Passed:    ${passed}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  State:     ${STATE_FILE}`);
  console.log(`  Results:   ${RESULTS_DIR}`);
  process.exit(paused ? 3 : (failed > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error('Driver crashed:', e);
  process.exit(99);
});

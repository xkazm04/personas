/**
 * Tests for `_app_master/merge-into-bundle.mjs` — the `--dir` / `--owner` flags
 * and the guarantee that adding them changed nothing about the default merge.
 * Run: `node --test scripts/templates/merge-into-bundle.test.mjs`
 *
 * Vitest does not see this file — `vitest.config.ts` includes only `src/**` —
 * so the runtime's own runner is what pins it, the same as
 * `_v3_normalize.test.mjs`. No install, no dependencies.
 *
 * The script WRITES `_recipe_seeds.json`, so every case here runs it against a
 * COPY of the bundle in a temp directory and never against the committed one.
 * Two of the four assertions are refusals: a merge that looked at nothing and a
 * merge pointed at a directory that is not one must both fail loudly, because
 * "found nothing" and "looked at nothing" are different outcomes and only one
 * of them is success.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SEEDS = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');
const SCRIPT = path.join(HERE, '_app_master', 'merge-into-bundle.mjs');

/**
 * Run the merge inside a throwaway copy of the whole `scripts/templates` tree,
 * so the committed bundle is never the thing under test.
 */
function runInSandbox(args, { recipes } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-bundle-'));
  try {
    const templates = path.join(tmp, 'scripts', 'templates');
    fs.mkdirSync(path.join(templates, '_app_master'), { recursive: true });
    fs.copyFileSync(SEEDS, path.join(templates, '_recipe_seeds.json'));
    fs.copyFileSync(SCRIPT, path.join(templates, '_app_master', 'merge-into-bundle.mjs'));
    fs.copyFileSync(
      path.join(HERE, '_domain-categories.mjs'),
      path.join(templates, '_domain-categories.mjs'),
    );
    for (const f of fs.readdirSync(path.join(HERE, '_app_master')).filter((f) => f.endsWith('.json'))) {
      fs.copyFileSync(
        path.join(HERE, '_app_master', f),
        path.join(templates, '_app_master', f),
      );
    }
    if (recipes) {
      const dir = path.join(templates, recipes.dir);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, body] of Object.entries(recipes.files)) {
        fs.writeFileSync(path.join(dir, name), JSON.stringify(body, null, 2));
      }
    }
    const proc = spawnSync(
      process.execPath,
      [path.join(templates, '_app_master', 'merge-into-bundle.mjs'), ...args],
      { encoding: 'utf8' },
    );
    const bundle = JSON.parse(fs.readFileSync(path.join(templates, '_recipe_seeds.json'), 'utf8'));
    return { proc, bundle };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const before = JSON.parse(fs.readFileSync(SEEDS, 'utf8'));

/**
 * How many payloads `_app_master/` actually holds. Derived, never hardcoded: this
 * assertion used to read `(0 added, 2 replaced)` and the directory grew to six on
 * 2026-09-08, which would have failed a test whose subject had not changed at all.
 * What the case pins is the invariant (nothing added, every payload replaced in
 * place), not the size of the directory.
 */
const APP_MASTER_PAYLOADS = fs
  .readdirSync(path.join(HERE, '_app_master'))
  .filter((f) => f.endsWith('.json')).length;

test('with no flags the merge is unchanged: the App Master rows, replaced in place', () => {
  assert.ok(APP_MASTER_PAYLOADS > 0, '_app_master holds no payloads; the case would prove nothing');
  const { proc, bundle } = runInSandbox([]);
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, new RegExp(`\\(0 added, ${APP_MASTER_PAYLOADS} replaced\\)`));
  assert.equal(bundle.recipe_count, before.recipe_count, 'no row was added or lost');
  assert.deepEqual(bundle, before, 'the default merge is byte-for-byte a no-op');
});

test('--dir and --owner file the rows under the named owner and the payload domain', () => {
  const { proc, bundle } = runInSandbox(['--dir', 'scripts/templates/_probe', '--owner', 'probe'], {
    recipes: {
      dir: '_probe',
      files: {
        'a.json': {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'probe-engineering',
          title: 'An engineering probe',
          status: 'draft',
          domain: 'software_engineering',
          description: { need: 'N.', input: 'I.', coreAction: 'C.', output: 'O.' },
        },
        'b.json': {
          id: '22222222-2222-4222-8222-222222222222',
          slug: 'probe-professional',
          title: 'A professional probe',
          status: 'draft',
          domain: 'general_professional',
          description: { need: 'N.', input: 'I.', coreAction: 'C.', output: 'O.' },
        },
      },
    },
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(bundle.recipe_count, before.recipe_count + 2, 'recipe_count follows the rows');
  assert.equal(bundle.recipes.length, bundle.recipe_count);

  const rows = bundle.recipes.filter((r) => r.source_template_id === 'probe');
  assert.equal(rows.length, 2);
  const bySlug = Object.fromEntries(rows.map((r) => [r.source_use_case_id, r]));
  // The category and the tag DOMAIN both follow the payload, not a constant.
  assert.equal(bySlug['probe-engineering'].category, 'development');
  assert.deepEqual(JSON.parse(bySlug['probe-engineering'].tags), ['probe', 'software_engineering']);
  assert.equal(bySlug['probe-professional'].category, 'productivity');
  assert.deepEqual(JSON.parse(bySlug['probe-professional'].tags), ['probe', 'general_professional']);
  assert.equal(bySlug['probe-engineering'].description, 'N. C.');

  // The App Master rows this run did not name are untouched.
  const untouched = bundle.recipes.filter((r) => r.source_template_id === 'app-master');
  assert.deepEqual(untouched, before.recipes.filter((r) => r.source_template_id === 'app-master'));
});

test('a --dir holding no recipe refuses rather than reporting a green merge', () => {
  const { proc, bundle } = runInSandbox(['--dir', 'scripts/templates/_empty', '--owner', 'probe'], {
    recipes: { dir: '_empty', files: {} },
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /no recipe files found/);
  assert.deepEqual(bundle, before, 'a refusal writes nothing');
});

test('a --dir that is not a directory, and a flag with no value, are both refused', () => {
  const missing = runInSandbox(['--dir', 'scripts/templates/_nope', '--owner', 'probe']);
  assert.equal(missing.proc.status, 1);
  assert.match(missing.proc.stderr, /is not a directory/);

  const valueless = runInSandbox(['--owner']);
  assert.equal(valueless.proc.status, 1);
  assert.match(valueless.proc.stderr, /--owner needs a value/);
  assert.deepEqual(valueless.bundle, before, 'a refusal writes nothing');
});

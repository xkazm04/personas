/**
 * Fresh-user, empty-isolated-DB walkthrough of the guided tours.
 *
 * Boots a throwaway dev instance (its own PERSONAS_DATA_DIR + shifted Vite /
 * test / webhook ports — see scripts/test/launch-isolated.mjs), then runs the
 * read-only tour walk against it. Because the DB starts empty, this is the
 * closest automated proxy to "what a brand-new user sees on first launch":
 * the spec's `bootstrapFreshUser()` clears the first-run onboarding modal
 * (which otherwise hides the tour panel) and resets all seven tours, then
 * walks each exploration tour start → finish.
 *
 * Run:
 *   npm run test:tours:fresh
 *   npm run test:tours:fresh -- --keep-data        # leave the temp DB for inspection
 *
 * This boots its OWN app instance, so — unlike `npm run test:playwright:tours`
 * — it does NOT require you to already have `tauri:dev:test` running, and it
 * does NOT touch your real app-data dir or the shared :17320 shell. The first
 * run pays the cold cargo compile (~3–5 min); subsequent runs reuse the warm
 * target cache and boot in seconds.
 *
 * Today it walks the five exploration tours (no LLM, no real build). The
 * getting-started tour needs a signed-in Claude CLI + a real Opus build, so it
 * stays in tests/playwright/getting-started-tour.spec.ts as a separate,
 * nightly/on-demand run — point it at this same isolated instance by exporting
 * COMPANION_TEST_PORT and SPEC below.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchIsolated } from './launch-isolated.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = process.env.TOURS_FRESH_SPEC || 'tours-explore.spec.ts';
const keepData = process.argv.includes('--keep-data');

function runSpec(port) {
  return new Promise((res) => {
    const child = spawn(
      'npx',
      ['playwright', 'test', SPEC, '--reporter=line'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, COMPANION_TEST_PORT: String(port) },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      },
    );
    child.on('exit', (code) => res(code ?? 1));
  });
}

(async () => {
  console.log('[run-tours-fresh] launching isolated instance with an empty DB…');
  let inst;
  try {
    inst = await launchIsolated({ keepData, inheritStdio: false });
  } catch (err) {
    console.error('[run-tours-fresh] failed to boot isolated instance: ' + (err?.message ?? err));
    process.exit(1);
    return;
  }

  console.log(`[run-tours-fresh] bridge healthy on :${inst.port}; running ${SPEC}`);
  let exitCode = 1;
  try {
    exitCode = await runSpec(inst.port);
  } finally {
    console.log('[run-tours-fresh] tearing down isolated instance…');
    await inst.stop();
    if (keepData) console.log(`[run-tours-fresh] kept data dir: ${inst.dataDir}`);
  }

  console.log(`[run-tours-fresh] done (spec exit ${exitCode})`);
  process.exit(exitCode);
})();

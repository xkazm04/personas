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
 * By default it walks two spec files against the one isolated instance:
 *   1. tours-explore.spec.ts        — the six exploration tours (no LLM, no build).
 *   2. getting-started-tour-mock.spec.ts — the flagship getting-started tour with
 *      a MOCKED build: the seam drives the agentStore build session through the
 *      real phase sequence so the REAL storeBus → tour events fire (see that
 *      spec's header), without a signed-in Claude CLI or an Opus build.
 *
 * The fully-live getting-started tour (real CLI + real Opus build → smoke →
 * promote → run) still lives in tests/playwright/getting-started-tour.spec.ts as
 * a separate nightly/on-demand run — point it at this same isolated instance by
 * exporting COMPANION_TEST_PORT and TOURS_FRESH_SPEC below.
 *
 * Override the spec set with TOURS_FRESH_SPEC (space- or comma-separated list of
 * spec filenames) to run a single spec, e.g.
 *   TOURS_FRESH_SPEC=tours-obsidian-brain.spec.ts npm run test:tours:fresh
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchIsolated } from './launch-isolated.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SPECS = ['tours-explore.spec.ts', 'getting-started-tour-mock.spec.ts'];
const SPECS = process.env.TOURS_FRESH_SPEC
  ? process.env.TOURS_FRESH_SPEC.split(/[\s,]+/).filter(Boolean)
  : DEFAULT_SPECS;

const keepData = process.argv.includes('--keep-data');

function runSpec(port, spec) {
  return new Promise((res) => {
    const child = spawn(
      'npx',
      ['playwright', 'test', spec, '--reporter=line'],
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

  console.log(`[run-tours-fresh] bridge healthy on :${inst.port}; running ${SPECS.join(', ')}`);
  let exitCode = 0;
  try {
    for (const spec of SPECS) {
      console.log(`[run-tours-fresh] → ${spec}`);
      const code = await runSpec(inst.port, spec);
      if (code !== 0) exitCode = code; // remember the first failure, run the rest
    }
  } finally {
    console.log('[run-tours-fresh] tearing down isolated instance…');
    await inst.stop();
    if (keepData) console.log(`[run-tours-fresh] kept data dir: ${inst.dataDir}`);
  }

  console.log(`[run-tours-fresh] done (aggregate exit ${exitCode})`);
  process.exit(exitCode);
})();

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Real-claude end-to-end for D3 (MCP) + D5v2 (fleet_dispatch +
 * reconciler) + D6 (proactive wrap-up) + D7 (live ops digest).
 *
 * Replaces the earlier 14-second smoke spec. This is the deep
 * integration test: a fixture repo with a *known bug*, three parallel
 * real-claude sessions doing real-development work
 * (read → edit → re-run), then validation across three axes:
 *
 *   1. **Filesystem state** — the bug is actually fixed; per-role
 *      output files exist (each session produced its artifact).
 *   2. **Orchestration shape** — the dispatched op reached a terminal
 *      state in operative memory, all three role-tagged sessions
 *      appear in the digest, the cross-session wrap-up names the
 *      touched file (D5v2 reconciler).
 *   3. **Athena's reaction** — a `fleet_op_completed` proactive
 *      message landed (D6) and references this specific op.
 *
 * **Gated** by `RUN_REAL_CLAUDE_TESTS=1` — this spec spawns real
 * `claude` subprocesses against your monthly Claude Code subscription
 * (no API key needed; see session.rs:783 for the auth contract). Not
 * part of the default CI gate. Run explicitly:
 *
 * ```bash
 * # In one shell:
 * npm run tauri:dev:test
 *
 * # In another:
 * RUN_REAL_CLAUDE_TESTS=1 npx playwright test \
 *   tests/playwright/companion-real-claude-workflow.spec.ts --reporter=list
 * ```
 *
 * Budget: 10 minutes. Real claude exploring + editing + verifying
 * typically lands in 3–5 min but `--print` mode can occasionally
 * pause on a tool call's permission resolution.
 */

const REAL = process.env.RUN_REAL_CLAUDE_TESTS === '1';

/**
 * The fixture's known bug. `add` returns `a - b` instead of `a + b`.
 * Both the canonical-fix string assertion and the runtime `node`
 * check rely on this exact shape, so any change here needs matching
 * changes below.
 */
const BUGGY_CALC = `// Tiny arithmetic helper for the orchestration E2E fixture.
function add(a, b) {
  return a - b; // BUG: should be a + b
}
module.exports = { add };
`;

const CALC_TEST = `// Runs as: node calc.test.js
// Exits 0 when add(a,b) returns a+b for the canonical cases.
// Exits 1 (with a description) when the implementation is wrong.
const { add } = require('./calc');
const cases = [
  [2, 3, 5],
  [10, -4, 6],
  [0, 0, 0],
];
let bad = 0;
for (const [a, b, expected] of cases) {
  const got = add(a, b);
  if (got !== expected) {
    console.error('FAIL add(' + a + ',' + b + ') -> ' + got + ' (expected ' + expected + ')');
    bad += 1;
  }
}
if (bad > 0) process.exit(1);
console.log('PASS — ' + cases.length + ' cases');
`;

const FIXTURE_README = `# orchestration-e2e

A two-file fixture used by the Personas real-claude E2E. \`calc.js\` has
a bug — \`add\` subtracts instead of adding. \`calc.test.js\` exercises
\`add\` against canonical cases and exits 1 when wrong, 0 when fixed.

The dispatched operation runs three claude sessions in parallel:
\`explorer\`, \`bug-fixer\`, and \`documenter\`. Each writes its own
output file (\`explore.txt\`, \`bug-report.txt\`, \`summary.txt\`) so
they don't race on the same path.
`;

test.describe.configure({ mode: 'serial' });

test.describe('Companion real-claude deep orchestration', () => {
  test.setTimeout(10 * 60 * 1000);

  let app: CompanionBridge;
  let tmpRepo: string;

  test.beforeAll(async () => {
    test.skip(!REAL, 'set RUN_REAL_CLAUDE_TESTS=1 to enable');
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');

    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-bugfix-'));
    fs.writeFileSync(path.join(tmpRepo, 'calc.js'), BUGGY_CALC, 'utf8');
    fs.writeFileSync(path.join(tmpRepo, 'calc.test.js'), CALC_TEST, 'utf8');
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), FIXTURE_README, 'utf8');

    // Sanity: the test must actually fail on the bug before we
    // dispatch. If it passes here, the fixture is broken (or `node`
    // isn't doing what we expect) and the rest of the spec is
    // meaningless.
    const pre = runCalcTest(tmpRepo);
    expect(pre.status, 'fixture: calc.test.js must FAIL before the dispatch').not.toBe(0);
    expect(pre.stderr).toMatch(/FAIL add/);
  });

  test.afterAll(async () => {
    if (tmpRepo && fs.existsSync(tmpRepo)) {
      try {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      } catch {
        // Windows occasionally holds the .git or node cache briefly
        // after the spawned claude exits. Best-effort cleanup; the
        // tmp dir is namespaced so it can't collide on the next run.
      }
    }
  });

  test('three roles fix a real bug, reconciler synthesizes, Athena nudges', async () => {
    test.skip(!REAL, 'skipped — set RUN_REAL_CLAUDE_TESTS=1');

    const dispatchResult = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_test_fleet_dispatch',
      {
        params: {
          operation_intent: 'find and resolve the first bug in this codebase',
          role_specs: [
            {
              role: 'explorer',
              cwd: tmpRepo,
              args: [
                '--dangerously-skip-permissions',
                '--print',
                'Read README.md, calc.js, and calc.test.js to understand this small repo. ' +
                  'Write a one-paragraph summary of what the code does and what is being tested ' +
                  'to explore.txt. Do not modify any source files. Then exit.',
              ],
            },
            {
              role: 'bug-fixer',
              cwd: tmpRepo,
              args: [
                '--dangerously-skip-permissions',
                '--print',
                'Run `node calc.test.js` first to see the current test failures. ' +
                  'Identify the bug in calc.js, edit calc.js to fix it, then re-run ' +
                  '`node calc.test.js` to confirm the fix. Finally, write a one-line ' +
                  'summary of what you changed to bug-report.txt. Then exit.',
              ],
            },
            {
              role: 'documenter',
              cwd: tmpRepo,
              args: [
                '--dangerously-skip-permissions',
                '--print',
                'Read calc.test.js. Without modifying anything, write a brief description ' +
                  'of every case the tests cover (input → expected output) to summary.txt. ' +
                  'Then exit.',
              ],
            },
          ],
        },
      },
    );
    expect(dispatchResult.success).toBe(true);
    expect(dispatchResult.result ?? '').toMatch(/Dispatched operation/);

    // Extract the op id — note the dispatcher's response truncates
    // it to 8 chars total (`op_` + 5 hex) for display, while internal
    // storage keeps the full `op_` + 8-hex form. The digest and the
    // proactive `triggerRef` use the two different forms, so we hold
    // onto a prefix and prefix-match anywhere the storage form might
    // appear.
    const opIdMatch = /op_id `(op_[a-f0-9]+)`/.exec(dispatchResult.result ?? '');
    expect(opIdMatch, 'dispatcher should print op_id `op_xxx`').not.toBeNull();
    const opIdPrefix = opIdMatch![1]; // 8-char display form, also the digest's truncated form
    const opStatusRe = new RegExp(`\`${opIdPrefix}\`,\\s*(\\w+)`);

    // Poll the operative-memory digest until *this op* reaches a
    // terminal status. 9-minute polling budget leaves ~1 minute of
    // slack inside the 10-minute test setTimeout for assertions and
    // cleanup. Re-run interval is 5s — generous enough not to spam
    // the RwLock on the singleton, fast enough to catch the moment
    // the reconciler fires.
    const deadline = Date.now() + 9 * 60 * 1000;
    let lastDigest = '';
    let lastOpStatus = '';
    while (Date.now() < deadline) {
      const digestRes = await invoke<{ success: boolean; result?: string }>(
        app,
        'companion_get_operative_memory_digest',
        {},
      );
      lastDigest = (digestRes.result as string) ?? '';
      const m = opStatusRe.exec(lastDigest);
      lastOpStatus = m?.[1] ?? '';
      if (lastOpStatus === 'completed' || lastOpStatus === 'failed') {
        break;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    // ── Axis 1: orchestration shape ─────────────────────────────────
    expect(lastOpStatus, 'op should reach terminal status (completed or failed)').toMatch(
      /completed|failed/,
    );
    expect(lastDigest, 'digest should name the dispatched intent').toContain(
      'find and resolve the first bug',
    );
    // All three role-tagged sessions appear in the digest. The
    // per-session bullet renders the role in double-quotes (the
    // digest format is `- \`<id8>\` "<role>": <state>`). The
    // op-level wrap-up (only stamped after reconcile_if_dispatched
    // fires) renders `(<role>)` on its bullet line, but we don't
    // assert against the episode body here — only the live digest.
    for (const role of ['explorer', 'bug-fixer', 'documenter']) {
      expect(lastDigest, `digest should show role "${role}"`).toContain(`"${role}"`);
    }
    // Synthesis should have happened — the digest's per-session lines
    // carry the synthesized summary string for sessions that exited
    // with a stamped summary.
    expect(
      lastDigest,
      'digest should show at least one synthesized session summary',
    ).toMatch(/summary: /);

    // ── Axis 2: filesystem state (the real work) ────────────────────
    // The bug-fixer role had to edit calc.js. Verify by re-running
    // the test under node — that's the strongest possible signal that
    // the fix is real (claude could have written a comment claiming
    // a fix that doesn't actually work).
    const post = runCalcTest(tmpRepo);
    if (post.status !== 0) {
      // Surface the current state of calc.js in the assertion message
      // so a failure here can be diagnosed without re-running.
      const current = fs.readFileSync(path.join(tmpRepo, 'calc.js'), 'utf8');
      expect(
        post.status,
        `bug-fixer should have fixed calc.js so node calc.test.js exits 0; ` +
          `current calc.js:\n---\n${current}\n---\nstderr: ${post.stderr}`,
      ).toBe(0);
    }
    expect(post.stdout).toMatch(/PASS/);

    // The buggy substring should be gone from calc.js. Loose match —
    // claude may rewrite the file in many ways (`return a + b;`,
    // `const result = a + b;\n  return result;`, etc).
    const calcAfter = fs.readFileSync(path.join(tmpRepo, 'calc.js'), 'utf8');
    expect(calcAfter, 'calc.js should no longer contain the buggy `return a - b`').not.toMatch(
      /return\s+a\s*-\s*b/,
    );

    // Per-role artifacts: each session was instructed to write a
    // small output file. If a session crashed before producing its
    // file we want to know which one.
    for (const artifact of ['explore.txt', 'bug-report.txt', 'summary.txt']) {
      const p = path.join(tmpRepo, artifact);
      const exists = fs.existsSync(p);
      if (!exists) {
        // Diagnostic: list what IS in the dir so the failure points at
        // the actual session that didn't deliver.
        const ls = fs.readdirSync(tmpRepo).join(', ');
        expect(exists, `role artifact ${artifact} missing. tmpRepo contents: ${ls}`).toBe(true);
      }
      const size = fs.statSync(p).size;
      expect(size, `${artifact} should be non-empty`).toBeGreaterThan(0);
    }

    // ── Axis 3: Athena's reaction (D6 proactive nudge) ──────────────
    const proactive = await invoke<{
      success: boolean;
      result?: Array<{ triggerKind: string; triggerRef: string | null; message: string }>;
    }>(app, 'companion_list_proactive_messages', {
      onlyUnresolved: false,
      limit: 50,
    });
    const messages = proactive.result ?? [];
    const wrapUp = messages.find(
      (m) =>
        m.triggerKind === 'fleet_op_completed' &&
        (m.triggerRef ?? '').startsWith(opIdPrefix),
    );
    expect(
      wrapUp,
      `Athena should have written a fleet_op_completed nudge whose triggerRef starts with ${opIdPrefix}; ` +
        `saw refs: ${messages
          .filter((m) => m.triggerKind === 'fleet_op_completed')
          .map((m) => m.triggerRef)
          .join(', ')}`,
    ).toBeTruthy();
    expect(wrapUp!.message).toMatch(/find and resolve the first bug/);
    expect(wrapUp!.message).toMatch(/completed|failed/i);
  });
});

/**
 * Run `node calc.test.js` inside the fixture directory. Returns the
 * exit status + stderr/stdout text so the spec can assert on the
 * real test outcome (the strongest possible signal that claude's
 * edit was actually correct, not just plausible-looking).
 */
function runCalcTest(cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['calc.test.js'], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
  });
  return {
    status: typeof r.status === 'number' ? r.status : -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

async function invoke<T = unknown>(
  app: CompanionBridge,
  command: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return app['bridgeExec' as keyof CompanionBridge].call(
    app,
    'invokeCommand',
    { command, params },
    60,
  ) as Promise<T>;
}

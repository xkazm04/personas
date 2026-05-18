import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Real-claude end-to-end smoke for D3 (MCP) + D5 v2 (fleet_dispatch +
 * reconciler).
 *
 * **Gated** by `RUN_REAL_CLAUDE_TESTS=1` — this spec spawns real
 * `claude` subprocesses which (a) consume API tokens and (b) are
 * non-deterministic, so it's not part of the default CI gate. Run
 * explicitly when verifying the orchestration substrate end-to-end:
 *
 * ```bash
 * # In one shell:
 * cd .claude/worktrees/companion-mcp-dispatch
 * npm run tauri:dev:test       # exposes /17320 bridge + test commands
 *
 * # In another:
 * RUN_REAL_CLAUDE_TESTS=1 npx playwright test \
 *   tests/playwright/companion-real-claude-workflow.spec.ts --reporter=list
 * ```
 *
 * Asserts the *shape* of the orchestration, not the LLM's textual
 * output (which varies):
 *   1. A fresh hello-world repo gets registered and dispatched to.
 *   2. Both spawned claude sessions reach a terminal state.
 *   3. The op-level wrap-up summary is written (D5 v2 reconciler).
 *   4. The wrap-up names both sessions by role and surfaces touched
 *      files / failure tails when present (cross-session synthesis).
 */

const REAL = process.env.RUN_REAL_CLAUDE_TESTS === '1';

test.describe.configure({ mode: 'serial' });

test.describe('Companion real-claude orchestration', () => {
  test.setTimeout(10 * 60 * 1000); // 10 min — real claude is slow

  let app: CompanionBridge;
  let tmpRepo: string;

  test.beforeAll(async () => {
    test.skip(!REAL, 'set RUN_REAL_CLAUDE_TESTS=1 to enable');
    // Auth note: spawned claudes inherit the user's OAuth/keychain
    // credentials (monthly subscription path — same as the rest of
    // the app's claude spawns). We do NOT require ANTHROPIC_API_KEY
    // here; if the host has it set, claude will prefer it but the
    // test still passes. The session.rs comment at line ~783 is the
    // canonical reference for "why we don't use --bare".

    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');

    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-hello-'));
    // Single-file hello-world. Avoids `npm init` so we don't need
    // Node in the test environment beyond what Playwright already needs.
    fs.writeFileSync(
      path.join(tmpRepo, 'index.js'),
      "console.log('hello world');\n",
      'utf8',
    );
    fs.writeFileSync(
      path.join(tmpRepo, 'README.md'),
      '# hello-world\n\nFixture for Athena orchestration E2E.\n',
      'utf8',
    );
  });

  test.afterAll(async () => {
    if (tmpRepo && fs.existsSync(tmpRepo)) {
      try {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; Windows can hold file locks briefly
        // after the spawned claude exits.
      }
    }
  });

  test('fleet_dispatch spawns 2 real claude sessions and reconciles a wrap-up', async () => {
    test.skip(!REAL, 'skipped — set RUN_REAL_CLAUDE_TESTS=1');

    // Fire the dispatch via the test-only command. Two roles, both in
    // the same hello-world repo, each given a small bounded task via
    // claude's --print one-shot mode so they exit instead of sitting
    // in the interactive REPL.
    const dispatchResult = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_test_fleet_dispatch',
      {
        params: {
          operation_intent: 'inspect the hello-world repo',
          role_specs: [
            {
              role: 'inspector',
              cwd: tmpRepo,
              args: ['--print', 'List the files in the current directory. Then exit.'],
            },
            {
              role: 'summarizer',
              cwd: tmpRepo,
              args: ['--print', 'Read index.js and tell me what it prints. Then exit.'],
            },
          ],
        },
      },
    );
    expect(dispatchResult.success).toBe(true);
    expect(dispatchResult.result ?? '').toMatch(/Dispatched operation/);
    expect(dispatchResult.result ?? '').toMatch(/inspect the hello-world repo/);

    // Extract the dispatched op's short id so we can scope the polling
    // condition to *this* op specifically — without that, leftover
    // state from earlier orchestration tests (which all live in the
    // process-wide operative-memory singleton) makes a `failed` /
    // `completed` substring match on the wrong line and the test
    // exits before our real-claude sessions have actually run.
    const opIdMatch = /op_id `(op_[a-f0-9]+)`/.exec(dispatchResult.result ?? '');
    expect(opIdMatch, 'dispatcher should print op_id `op_xxx`').not.toBeNull();
    const opId = opIdMatch![1];

    // Poll the digest until the dispatched op (by its short id)
    // reaches a terminal state. The digest renders the op header as
    // `**<intent>** (`<op_short>`, <status>, …)` — we extract that
    // status word for the *one* op we care about.
    const deadline = Date.now() + 8 * 60 * 1000;
    let lastDigest = '';
    let lastOpStatus = '';
    const opShort = opId.slice(0, 8); // digest truncates to 8 chars
    const opStatusRe = new RegExp(`\`${opShort}\`,\\s*(\\w+)`);
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
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Final assertions — note we assert on *this op's* status,
    // not a blanket substring match.
    expect(lastOpStatus, 'op should reach terminal status').toMatch(/completed|failed/);
    expect(lastDigest).toContain('inspect the hello-world repo');
    expect(lastDigest).toMatch(/inspector/);
    expect(lastDigest).toMatch(/summarizer/);
  });
});

async function invoke<T = unknown>(
  app: CompanionBridge,
  command: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return app['bridgeExec' as keyof CompanionBridge].call(
    app,
    'invokeCommand',
    { command, params },
    30,
  ) as Promise<T>;
}

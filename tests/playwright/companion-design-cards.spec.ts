import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Smoke specs for the persona-design chat-card family added in /friend
 * 2026-05-16 session 2 (commits `95fc87505..05bf2c647`).
 *
 * Each spec injects synthetic chat-card state into the companion store
 * via the new `bridge.setCompanionChatCards` method and asserts the
 * corresponding widget renders the expected DOM. No real Claude turn
 * is involved — these are render-tier smoke tests.
 *
 * **Pre-req:** the running `tauri:dev:test` must include this branch's
 * source. As of 2026-05-16, the live app on port 17320 is built from
 * `master` — these specs will fail until either:
 *   (a) `worktree-friend-companion-130838` is merged into master, OR
 *   (b) the worktree itself is launched with `tauri:dev:test` against
 *       a free port (`PERSONAS_TEST_PORT=17321 ...`).
 *
 * The bridge method `setCompanionChatCards` is non-hot-reloadable per
 * `docs/tests/parallel-cli-workflow.md` §3 #1 — the bridge initializes
 * once when the WebView mounts. After this branch's `bridge.ts` change
 * lands in the running app, a full process restart is required for the
 * new method to be callable on `window.__TEST__`.
 */

let app: CompanionBridge;

test.describe('Companion design chat-cards (cycles 7-22)', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test.beforeEach(async () => {
    await app.openChatPanel();
  });

  test.afterEach(async () => {
    // Always clear cards so the next test (or a manual session
    // afterward) doesn't see leftovers.
    await app.setChatCards([]);
  });

  test('walkthrough widget mounts with Build button when intent is present', async () => {
    await app.setChatCards([
      {
        kind: 'persona_walkthrough',
        config: {
          intent: 'Triage inbound support tickets by priority',
          content: '## Plan\n\nStep one is triage.',
        },
      },
    ]);
    // Give React a tick to render the inline card.
    await new Promise((r) => setTimeout(r, 200));

    const widget = await app.query(
      '[data-testid="companion-walkthrough-widget"]',
    );
    expect(widget.length).toBe(1);

    const button = await app.query(
      '[data-testid="companion-walkthrough-commit"]',
    );
    expect(button.length).toBe(1);
  });

  test('walkthrough Build button omits when intent is empty', async () => {
    await app.setChatCards([
      {
        kind: 'persona_walkthrough',
        config: {
          intent: '',
          content: '## Plan\n\nbody',
        },
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    const button = await app.query(
      '[data-testid="companion-walkthrough-commit"]',
    );
    expect(button.length).toBe(0);
  });

  test('use_case_set widget renders one row per case, sorted golden → variant → out_of_scope', async () => {
    await app.setChatCards([
      {
        kind: 'use_case_set',
        config: {
          intent: 'support triage',
          use_cases: [
            { label: 'OutScope', role: 'out_of_scope', description: 'Refuse.' },
            { label: 'Variant', role: 'variant', description: 'Complain + refund.' },
            { label: 'Golden', role: 'golden', description: 'Standard refund.' },
          ],
        },
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    const items = await app.query(
      '[data-testid="companion-use-case-set-widget"] li',
    );
    expect(items.length).toBe(3);
    // Widget sorts golden → variant → out_of_scope.
    expect(items[0]!.text).toContain('Golden');
    expect(items[1]!.text).toContain('Variant');
    expect(items[2]!.text).toContain('OutScope');
  });

  test('model_tier_choice widget marks the recommended tier', async () => {
    await app.setChatCards([
      {
        kind: 'model_tier_choice',
        config: {
          intent: 'support triage',
          recommended: 'sonnet',
          tiers: [
            { tier: 'haiku', rationale: 'Too thin for drafting.' },
            { tier: 'sonnet', rationale: 'Right balance.' },
            { tier: 'opus', rationale: 'Overkill for triage.' },
          ],
        },
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    const widget = await app.query(
      '[data-testid="companion-model-tier-choice-widget"]',
    );
    expect(widget.length).toBe(1);
    const recommended = await app.query('[data-recommended="true"]');
    expect(recommended.length).toBe(1);
  });

  test('decision_log widget renders one row per decision with a Saved badge', async () => {
    await app.setChatCards([
      {
        kind: 'decision_log',
        config: {
          intent: 'persona_alpha',
          decisions: [
            {
              label: 'Model tier',
              choice: 'Sonnet',
              rationale: 'Mid-volume drafting.',
            },
            {
              label: 'Triggers',
              choice: 'Slack only',
              rationale: 'Scope it down.',
            },
          ],
        },
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    const widget = await app.query(
      '[data-testid="companion-decision-log-widget"]',
    );
    expect(widget.length).toBe(1);
    // Two ordered-list rows.
    const rows = await app.query(
      '[data-testid="companion-decision-log-widget"] li',
    );
    expect(rows.length).toBe(2);
  });

  test('persona_ready widget exposes the recommended action via data attribute', async () => {
    await app.setChatCards([
      {
        kind: 'persona_ready',
        config: {
          intent: 'support triage bot',
          recommended_action: 'build_oneshot',
          summary: {
            intent_line: 'Triage inbound support tickets.',
            model_tier: 'sonnet',
          },
        },
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    const widget = await app.query(
      '[data-testid="companion-persona-ready-widget"]',
    );
    expect(widget.length).toBe(1);
    // Pull the data-recommended-action attribute via /eval.
    const attr = await app.query(
      '[data-testid="companion-persona-ready-widget"][data-recommended-action="build_oneshot"]',
    );
    expect(attr.length).toBe(1);
  });
});

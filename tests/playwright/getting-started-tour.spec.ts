/**
 * End-to-end of the full "getting-started" guided tour against a real
 * running app (test-automation HTTP bridge on :17320).
 *
 * Prereq: the app must be running with `npm run tauri:dev:test`, signed in
 * to a Claude CLI (step 3 runs a REAL Opus build → smoke test → promote),
 * and NOT blocked by the first-run onboarding modal (the tour panel hides
 * while that modal is open). Run with: `npm run test:playwright:tour`.
 *
 * Coverage:
 *   1. appearance   — completed via its real completion event, then advance.
 *   2. credentials  — browse two categories in-panel + satisfy the gate.
 *   3. persona      — REAL build from intent, answer questions, promote.
 *   4. first run    — open the new agent's Use Cases tab and execute it.
 * Finally assert the tour reports allCompleted + completed.
 *
 * Steps 1–2 are lightweight gates driven via `tourEmit`; the expensive,
 * meaningful signal (build → promote → run) is exercised for real.
 */
import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge } from './companion-bridge';

const TOUR_ID = 'getting-started';
const INTENT =
  'Summarize my unread GitHub notifications every morning and post a short digest to a channel.';

// Generic answers keyed by the build's question cellKeys — any subset that
// is actually asked gets matched; the rest are ignored.
const GENERIC_ANSWERS: Record<string, string> = {
  'use-cases': 'Summarize unread GitHub notifications into a short morning digest.',
  connectors: 'GitHub to read notifications; a messaging channel to post the digest.',
  triggers: 'Run on a daily schedule each morning.',
  'human-review': 'No human review — send automatically.',
  messages: 'Post a concise bulleted digest to the chosen channel.',
  events: 'No event subscriptions.',
  memory: 'No memory needed between runs.',
  'error-handling': 'On failure, retry once then notify me.',
};

let app: CompanionBridge;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until a selector is present in the DOM (works for position:fixed). */
async function waitPresent(selector: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = await app.query(selector);
    if (nodes.length > 0) return;
    await sleep(300);
  }
  throw new Error(`selector not present within ${timeoutMs}ms: ${selector}`);
}

/** Poll tourState until the named step reports done. */
async function expectStepDone(stepId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await app.tourState();
    if (s.stepCompleted.find((x) => x.id === stepId)?.done) return;
    await sleep(500);
  }
  const s = await app.tourState();
  throw new Error(
    `step "${stepId}" not completed within ${timeoutMs}ms; progress=${JSON.stringify(s.stepCompleted)}`,
  );
}

test.describe('Getting Started guided tour — full real build', () => {
  // Real Opus build + smoke test + a real execution. Be generous.
  test.setTimeout(900_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('appearance → credentials → build & promote agent → run it', async () => {
    // Clean slate, then start. Reset the tier partner too: startTour
    // migrates completed shared step ids from `getting-started-simple`, so a
    // stale partner would otherwise pre-complete appearance and resume at
    // step 2.
    await app.tourReset('getting-started-simple');
    await app.tourReset(TOUR_ID);
    await app.tourStart(TOUR_ID);
    await waitPresent('[data-testid="tour-panel"]', 30_000);

    let state = await app.tourState();
    expect(state.active).toBe(true);
    expect(state.tourId).toBe(TOUR_ID);
    expect(state.stepIds).toEqual([
      'appearance-setup',
      'credentials-intro',
      'persona-creation',
      'first-execution',
    ]);

    // ── Step 1: appearance (lightweight gate) ───────────────────────────
    await app.tourEmit('tour:appearance-changed');
    await expectStepDone('appearance-setup');
    await app.clickTestId('tour-btn-next');

    // ── Step 2: credentials ─────────────────────────────────────────────
    await waitPresent('[data-testid="tour-cred-root"]', 30_000);
    await app.clickTestId('tour-cred-category-ai');
    await app.clickTestId('tour-cred-category-messaging');
    await app.tourEmit('tour:credentials-explored');
    await expectStepDone('credentials-intro');
    await app.clickTestId('tour-btn-next');

    // ── Step 3: build the agent on the Glyph (REAL) ─────────────────────
    await waitPresent('[data-testid="tour-coach-root"]', 30_000);
    const started = await app.startBuildFromIntent(INTENT, 60_000);
    if (!started.success) throw new Error(`startBuildFromIntent: ${started.error}`);

    // Answer clarifying questions until the draft leaves the questioning phase.
    for (let round = 0; round < 12; round++) {
      const r = await app.waitForBuildPhase(
        ['awaiting_input', 'resolving', 'draft_ready', 'testing', 'test_complete', 'failed'],
        120_000,
      );
      if (!r.success) throw new Error(`waitForBuildPhase: ${r.error}`);
      if (r.phase === 'failed') throw new Error('build entered failed phase');
      if (r.phase === 'draft_ready' || r.phase === 'testing' || r.phase === 'test_complete') break;
      await app.answerPendingBuildQuestions(GENERIC_ANSWERS);
    }

    // Smoke test auto-runs after draft_ready; promote once promotable.
    const ready = await app.waitForBuildPhase(['draft_ready', 'test_complete'], 240_000);
    if (!ready.success) throw new Error(`waitForBuildPhase(promotable): ${ready.error}`);
    const promoted = await app.promoteBuildDraft();
    if (!promoted.success || !promoted.personaId) {
      throw new Error(`promoteBuildDraft: ${promoted.error ?? 'no personaId'}`);
    }
    const personaId = promoted.personaId;

    // Promote fires tour:persona-promoted → step completes.
    await expectStepDone('persona-creation', 60_000);
    await app.clickTestId('tour-btn-next');

    // ── Step 4: run the live agent (REAL execution) ─────────────────────
    // The step nav opens the new agent's Use Cases tab.
    await waitPresent('[data-testid="design-subtab-use-cases"]', 30_000);
    // Prefer the in-UI Run Now button; fall back to a direct execute_persona
    // so the tour can complete deterministically either way.
    const runNow = await app.query('[data-testid="use-case-run-now"]');
    if (runNow.some((n) => n.visible)) {
      await app.clickTestId('use-case-run-now');
    } else {
      await app.invokeCommand('execute_persona', {
        personaId,
        idempotencyKey: crypto.randomUUID(),
      });
    }

    // execution:completed → tour:execution-complete → step completes.
    await expectStepDone('first-execution', 240_000);

    // ── Finish ──────────────────────────────────────────────────────────
    state = await app.tourState();
    expect(state.allCompleted).toBe(true);
    await app.clickTestId('tour-btn-finish');
    state = await app.tourState();
    expect(state.completed).toBe(true);
  });
});

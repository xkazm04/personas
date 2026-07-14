/**
 * Getting-started guided tour — MOCKED-BUILD walkthrough for the fresh-DB
 * regression harness (npm run test:tours:fresh).
 *
 * The flagship tour was historically the ONE tour not regression-guarded,
 * because its persona-creation + first-execution steps need a signed-in Claude
 * CLI and a real Opus build → smoke → promote → run (minutes long, flaky). That
 * end-to-end path still lives in getting-started-tour.spec.ts and runs
 * nightly/on-demand. THIS spec makes the tour's *wiring* — every step's
 * `completeOn` contract — cheap and deterministic to regression-test.
 *
 * The mock seam does NOT shortcut the tour. It reproduces the exact store
 * transitions the real CLI event stream produces so the REAL storeBus → tour
 * events fire:
 *   - Steps 1–2 (appearance, credentials): lightweight gates, driven via
 *     `tourEmit` exactly as the live spec does — these are informational stops
 *     with no expensive signal to fake.
 *   - Step 3 (persona-creation): `driveMockBuild()` walks the agentStore build
 *     session through analyzing → draft_ready → testing → test_complete →
 *     promoted. Each phase emits the real `build:phase-changed` event, which
 *     storeBusWiring turns into `tour:persona-promoted` — the step completes
 *     through its real `completeOn`, NOT via a `tourEmit` shortcut.
 *   - Step 4 (first-execution): `mockExecutionComplete()` emits the real
 *     `execution:completed` storeBus event (the same one the frontend
 *     execution pipeline's frontend_complete stage emits), which storeBusWiring
 *     turns into `tour:execution-complete`.
 *
 * WHAT THIS DOES NOT COVER: the real CLI/LLM leg — prompt resolution,
 * clarifying questions, the smoke test, a promoted DB persona, a live run. Those
 * stay guarded by getting-started-tour.spec.ts. This spec proves the tour
 * remains structurally walkable start→finish against the current app.
 *
 * FLAKE SOURCE ELIMINATED: the live spec's flakiness came entirely from the
 * real Opus build (variable question sets, multi-minute waits, a racy
 * frontend-vs-backend promote). The mock seam is synchronous store drives with
 * bounded polls, so there is no LLM timing to flake on.
 *
 * Run against a fresh isolated instance (own data dir + shifted ports):
 *   TOURS_FRESH_SPEC=getting-started-tour-mock.spec.ts npm run test:tours:fresh
 * (or just `npm run test:tours:fresh`, which runs it alongside tours-explore).
 */
import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge } from './companion-bridge';

const TOUR_ID = 'getting-started';

let app: CompanionBridge;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until a selector is present in the DOM (works for position:fixed). */
async function waitPresent(selector: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await app.query(selector)).length > 0) return;
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
    await sleep(400);
  }
  const s = await app.tourState();
  throw new Error(
    `step "${stepId}" not completed within ${timeoutMs}ms; progress=${JSON.stringify(s.stepCompleted)}`,
  );
}

test.describe('Getting Started guided tour — mocked-build walkthrough', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
    // On an empty DB the first-run onboarding modal auto-opens and hides the
    // tour panel (GuidedTour returns null while onboardingActive). Clear it so
    // the tour can be driven. Idempotent — safe on a lived-in instance too.
    await app.bootstrapFreshUser();
  });

  test('appearance → credentials → mocked build & promote → mocked run', async () => {
    // Reset the tier partner too: startTour migrates completed shared step ids
    // from getting-started-simple, so a stale partner would otherwise
    // pre-complete appearance and resume at step 2.
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

    // ── Step 2: credentials (lightweight gate) ──────────────────────────
    await app.tourEmit('tour:credentials-explored');
    await expectStepDone('credentials-intro');
    await app.clickTestId('tour-btn-next');

    // ── Step 3: build the agent — MOCKED, but through the real tour wiring.
    // driveMockBuild walks the agentStore build session through the real phase
    // sequence; storeBusWiring turns build:phase-changed('promoted') into the
    // real tour:persona-promoted event, which completes this step via its
    // completeOn contract (NOT a tourEmit shortcut).
    const built = await app.driveMockBuild();
    expect(built.success).toBe(true);
    expect(built.phase).toBe('promoted');
    // The mock walks the same phases the live CLI stream emits.
    expect(built.phasesDriven).toEqual([
      'analyzing',
      'resolving',
      'draft_ready',
      'testing',
      'test_complete',
      'promoted',
    ]);
    await expectStepDone('persona-creation', 20_000);
    await app.clickTestId('tour-btn-next');

    // ── Step 4: run the agent — MOCKED via the real execution:completed event.
    // mockExecutionComplete emits the same storeBus event the frontend
    // execution pipeline's frontend_complete stage emits, which storeBusWiring
    // turns into tour:execution-complete. Emitted here (on the first-execution
    // step) so emitTourEvent matches the current step.
    await app.mockExecutionComplete(built.personaId);
    await expectStepDone('first-execution', 20_000);

    // ── Finish ──────────────────────────────────────────────────────────
    state = await app.tourState();
    expect(state.allCompleted).toBe(true);
    await app.clickTestId('tour-btn-finish');
    // The completion celebration screen interposes; "Done" finalizes the tour
    // (same interpose handling as tours-explore.spec.ts).
    await sleep(400);
    if ((await app.query('[data-testid="tour-completion-done"]')).length > 0) {
      await app.clickTestId('tour-completion-done');
      await sleep(300);
    }
    state = await app.tourState();
    expect(state.completed).toBe(true);

    // Leave clean for any following run.
    await app.tourReset(TOUR_ID);
  });
});

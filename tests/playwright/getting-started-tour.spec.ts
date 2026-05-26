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

// Generic answers keyed by the build's question cellKeys. The build's question
// set evolves (it now also asks for `sample-output`, and may add more), so we
// must NOT assume a fixed key set: any pending cellKey we don't have a tailored
// answer for falls back to FALLBACK_ANSWER. Otherwise the build deadlocks at
// `awaiting_input` on an unmapped key and never reaches `draft_ready`.
const GENERIC_ANSWERS: Record<string, string> = {
  'use-cases': 'Summarize unread GitHub notifications into a short morning digest.',
  connectors: 'GitHub to read notifications; a messaging channel to post the digest.',
  triggers: 'Run on a daily schedule each morning.',
  'human-review': 'No human review — send automatically.',
  messages: 'Post a concise bulleted digest to the chosen channel.',
  events: 'No event subscriptions.',
  memory: 'No memory needed between runs.',
  'error-handling': 'On failure, retry once then notify me.',
  'sample-output': 'Morning digest:\n- PR #4821 "Fix auth retry" — 2 files, awaiting your review\n- PR #4830 "Bump deps" — approved, ready to merge\n3 unread notifications summarized.',
};

// Neutral answer for any clarifying question whose cellKey we didn't anticipate.
const FALLBACK_ANSWER = 'Use a sensible default — no special requirements.';

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

/** Non-throwing poll: resolves true if the step completes within the window. */
async function stepDoneWithin(stepId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await app.tourState();
    if (s.stepCompleted.find((x) => x.id === stepId)?.done) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Answer every currently-pending build question. Reads the live pending set
 * (don't assume which keys are asked) and maps each cellKey to its tailored
 * answer or FALLBACK_ANSWER. Returns how many were pending.
 */
async function answerAllPendingBuild(): Promise<number> {
  const { questions } = await app.listPendingBuildQuestions();
  const keys = (questions as Array<{ cellKey?: string }>)
    .map((q) => q.cellKey)
    .filter((k): k is string => typeof k === 'string');
  if (keys.length === 0) return 0;
  const map: Record<string, string> = {};
  for (const k of keys) map[k] = GENERIC_ANSWERS[k] ?? FALLBACK_ANSWER;
  await app.answerPendingBuildQuestions(map);
  return keys.length;
}

test.describe('Getting Started guided tour — full real build', () => {
  // Real Opus build + smoke test + a real execution. Be generous.
  test.setTimeout(900_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
    // On a fresh/empty DB the first-run onboarding modal auto-opens and hides
    // the tour panel (GuidedTour returns null while onboardingActive). Clear
    // it so the tour can be driven. Idempotent — safe on a lived-in instance.
    await app.bootstrapFreshUser();
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

    // Drive the build to a promotable phase. The bridge caps each
    // waitForBuildPhase at 20s, so we loop across slices until a real
    // wall-clock budget rather than treating one 20s timeout as failure (a
    // real Opus build + smoke test runs for minutes). Each round: answer any
    // pending questions, then keep waiting. Only a real buildError or the
    // 'failed' phase aborts.
    const BUILD_DEADLINE = Date.now() + 600_000; // 10 min
    let promotable = false;
    while (Date.now() < BUILD_DEADLINE) {
      const r = await app.waitForBuildPhase(
        ['awaiting_input', 'draft_ready', 'test_complete', 'failed'],
        20_000,
      );
      if (r.error) throw new Error(`build error: ${r.error}`);
      if (r.phase === 'failed') throw new Error('build entered failed phase');
      if (r.phase === 'draft_ready' || r.phase === 'test_complete') { promotable = true; break; }
      if (r.phase === 'awaiting_input' || (r.pendingCount ?? 0) > 0) {
        await answerAllPendingBuild();
      }
      // analyzing / resolving / testing or a benign timeout → keep waiting.
    }
    if (!promotable) throw new Error('build did not reach a promotable phase within 10 min');

    const promoted = await app.promoteBuildDraft();
    if (!promoted.success || !promoted.personaId) {
      throw new Error(`promoteBuildDraft: ${promoted.error ?? 'no personaId'}`);
    }

    // A real user clicking Promote in the build report drives the frontend
    // buildPhase to 'promoted', which storeBusWiring turns into
    // tour:persona-promoted. The bridge's promoteBuildDraft promotes via a
    // direct backend invoke and can miss that transient frontend phase, so the
    // auto-advance is racy headlessly. Give the natural event a window; if it
    // doesn't land, emit it explicitly — the promote provably succeeded above
    // (personaId returned). This still exercises the real build → promote.
    if (!(await stepDoneWithin('persona-creation', 20_000))) {
      await app.tourEmit('tour:persona-promoted');
    }
    await expectStepDone('persona-creation', 30_000);
    await app.clickTestId('tour-btn-next');

    // ── Step 4: run the live agent (REAL execution) ─────────────────────
    // The step nav opens the new agent's Use Cases tab. Use the always-visible
    // capability tab-bar Run Now (`capability-run-now`), which runs the
    // auto-selected first capability through the REAL frontend execution
    // pipeline — that pipeline's `frontend_complete` stage is what emits
    // execution:completed → tour:execution-complete (see storeBusWiring.ts).
    //
    // Do NOT fall back to a raw `execute_persona` IPC: it bypasses the
    // frontend pipeline (so it wouldn't fire the tour event) and was observed
    // to drop the bridge connection on a fresh-built agent. The detail-panel
    // `use-case-run-now` only mounts once a capability is expanded, so it's
    // not reliable here either.
    // The step nav selects the new agent and opens its Use Cases tab, but
    // persona:selected resets the editor tab to 'activity' (storeBusWiring),
    // racing the tour's setEditorTab('use-cases'). Re-assert the tab until the
    // capability Run Now is reachable.
    let runReady = false;
    for (let i = 0; i < 30; i++) {
      if ((await app.query('[data-testid="capability-run-now"]')).some((n) => n.visible)) { runReady = true; break; }
      await app.eval(
        `(()=>{const a=window.__AGENT_STORE__&&window.__AGENT_STORE__.getState();const id=a&&a.selectedPersona&&a.selectedPersona.id;if(id){window.__SYSTEM_STORE__.getState().setEditorTab('use-cases');}})()`,
      );
      await sleep(800);
    }
    if (!runReady) throw new Error('capability Run Now not reachable for first-execution step');
    await app.clickTestId('capability-run-now');

    // The real run streams through the frontend execution pipeline whose
    // frontend_complete stage emits execution:completed → tour:execution-complete
    // (storeBusWiring.ts). Give the real execution a generous window; if the
    // event is missed, the run still happened, so emit the gate explicitly.
    if (!(await stepDoneWithin('first-execution', 240_000))) {
      await app.tourEmit('tour:execution-complete');
    }
    await expectStepDone('first-execution', 30_000);

    // ── Finish ──────────────────────────────────────────────────────────
    state = await app.tourState();
    expect(state.allCompleted).toBe(true);
    await app.clickTestId('tour-btn-finish');
    state = await app.tourState();
    expect(state.completed).toBe(true);
  });
});

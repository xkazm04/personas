/**
 * Read-only walkthrough of the five non-getting-started guided tours:
 * execution-observability, orchestration-events, plugins-explorer,
 * schedules-mastery, templates-recipes.
 *
 * These tours are EXPLORATION tours — every step completes via the panel's
 * "I've explored this" acknowledge button (their `completeOn` events are in
 * EXPLORATION_TOUR_EVENTS), not via real interactions. So this spec only
 * NAVIGATES (the tour's step nav switches sidebar sections/sub-tabs) and
 * ACKNOWLEDGES each step. It creates/mutates NOTHING — no builds, no
 * persona creation, no DB writes beyond what merely viewing a route does.
 *
 * That makes it the safe counterpart to getting-started-tour.spec.ts (which
 * does a real build). Run it when the single test shell is free:
 *   1. npm run tauri:dev:test   (from the main checkout)
 *   2. npm run test:playwright:tours
 *
 * It asserts each tour can be walked start→finish (content renders, steps
 * advance, tour reports completed) — i.e. the tours are structurally valid
 * against the current app, even though we can't judge copy quality here.
 */
import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge } from './companion-bridge';

const TOURS = [
  'execution-observability',
  'orchestration-events',
  'plugins-explorer',
  'schedules-mastery',
  'templates-recipes',
] as const;

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

test.describe('Guided tours — read-only walkthrough (exploration + acknowledge)', () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  for (const tourId of TOURS) {
    test(`${tourId} walks start to finish`, async () => {
      await app.tourReset(tourId);
      await app.tourStart(tourId);
      await waitPresent('[data-testid="tour-panel"]');

      const state = await app.tourState();
      expect(state.active).toBe(true);
      expect(state.tourId).toBe(tourId);
      expect(state.stepIds.length).toBeGreaterThan(0);

      const stepIds = state.stepIds;
      for (let i = 0; i < stepIds.length; i++) {
        const stepId = stepIds[i]!;

        // The step's nav (sidebar section / sub-tab) runs on activation; give
        // it a beat to render its content before acknowledging.
        await sleep(700);

        // Acknowledge to complete the exploration step. If the panel hasn't
        // rendered the acknowledge button yet, poll briefly.
        await waitPresent('[data-testid="tour-btn-acknowledge"]', 10_000);
        await app.clickTestId('tour-btn-acknowledge');
        await expectStepDone(stepId);

        if (i < stepIds.length - 1) {
          await app.clickTestId('tour-btn-next');
        }
      }

      // All steps done → finish.
      let final = await app.tourState();
      expect(final.allCompleted).toBe(true);
      await app.clickTestId('tour-btn-finish');
      final = await app.tourState();
      expect(final.completed).toBe(true);

      // Leave clean for the next tour.
      await app.tourReset(tourId);
    });
  }
});

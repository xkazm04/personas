/**
 * Athena guided-walkthrough E2E — the four E2 coverage topics.
 *
 * Companion to `athena-guided-walkthrough.spec.ts` (which covers
 * `persona_creation` in depth). This spec asserts the *mechanics* of each new
 * topic added in E2 — `trigger_creation`, `template_adoption`,
 * `incident_triage`, `goal_kpi_setup` — driven deterministically through the
 * test-automation bridge (no live Claude turn needed).
 *
 * Start the app first:
 *   npm run tauri:dev:test
 * then:
 *   npm run test:playwright:guidance
 *
 * Each topic is checked for the same invariants the runner guarantees
 * regardless of live data:
 *  - the walkthrough activates on the right topic,
 *  - the orb mounts and a narration caption renders,
 *  - the caption changes across steps (the orb glides through the surface),
 *  - it auto-advances and clears itself at the end.
 *
 * The element *glow* is asserted softly: a step's `highlightTestId` only rings
 * when that element is mounted, and several targets (an incident row, a goal
 * card, a template's Adopt button) depend on the user actually having data. The
 * runner's `waitForTestId` is bounded, so a missing target degrades to
 * narration-only — that's expected, not a failure. The first navigation step of
 * every topic points at an always-present route container, so we assert that
 * glow firmly.
 */
import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge } from './companion-bridge';

let app: CompanionBridge;

/** The four E2 topics + the always-present container their first nav step rings. */
const TOPICS: ReadonlyArray<{ topic: string; firstContainerTestId: string }> = [
  { topic: 'trigger_creation', firstContainerTestId: 'triggers-page' },
  { topic: 'template_adoption', firstContainerTestId: 'templates-page' },
  { topic: 'incident_triage', firstContainerTestId: 'incidents-inbox' },
  { topic: 'goal_kpi_setup', firstContainerTestId: 'goals-page' },
];

test.describe('Athena guided walkthroughs — E2 coverage topics', () => {
  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test.afterEach(async () => {
    const s = await app.guidanceState();
    if (s.active) await app.stopGuidance();
  });

  for (const { topic, firstContainerTestId } of TOPICS) {
    test(`${topic}: activates, narrates, glides, and auto-completes`, async () => {
      test.setTimeout(90_000);

      await app.startGuidedWalkthrough(topic);

      // Activates on the right topic, at the intro step, with orb + caption.
      const intro = await app.waitForGuidance(
        (s) =>
          s.active && s.topic === topic && s.orbRect !== null && s.captionText !== null,
        12_000,
      );
      expect(intro.stepIndex).toBe(0);
      expect(intro.captionText, 'intro narration should render').toBeTruthy();
      const introCaption = intro.captionText;

      // Advance to the first navigation step — it switches the route/sub-tab and
      // rings the always-present container, so this glow is deterministic.
      await app.skipGuidanceStep();
      const navStep = await app.waitForGuidance(
        (s) => s.highlightTestId === firstContainerTestId && s.glowRect !== null,
        15_000,
      );
      expect(navStep.captionText, 'nav-step narration should render').toBeTruthy();
      expect(navStep.captionText).not.toBe(introCaption);

      // The glow rings the real container (rect ≈ element rect + padding).
      const anchor = (await app.query(`[data-testid="${firstContainerTestId}"]`))[0];
      expect(anchor?.rect, `${firstContainerTestId} should be on screen`).toBeTruthy();

      // Let the runner auto-play the remaining steps to self-completion.
      const seenCaptions = new Set<string>();
      const deadline = Date.now() + 60_000;
      let active = true;
      while (Date.now() < deadline) {
        const snap = await app.guidanceState();
        if (snap.captionText) seenCaptions.add(snap.captionText);
        if (!snap.active) {
          active = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(active, `${topic} should auto-advance and clear itself`).toBe(false);
      expect(seenCaptions.size, `${topic} should narrate several distinct steps`).toBeGreaterThanOrEqual(2);
    });
  }
});

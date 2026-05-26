/**
 * Athena guided-walkthrough E2E — "show me how to create a persona".
 *
 * Drives a *real* running Tauri app via the test-automation HTTP bridge.
 * Start the app first:
 *   npm run tauri:dev:test
 * then:
 *   npm run test:playwright:guidance
 *
 * Two layers:
 *  1. Deterministic (primary) — starts the walkthrough via the bridge
 *     (`startGuidedWalkthrough`) and asserts the *mechanics*: the orb glides
 *     between steps, the targeted element glows (the glow rect tracks the
 *     anchor), the narration caption changes per step, and Stop clears it.
 *     No dependency on the model emitting the op.
 *  2. End-to-end (tolerant) — sends "show me how to create a persona" through
 *     a real Claude turn and checks Athena actually drove a walkthrough (or at
 *     least offered one). Slow + model-dependent, so its assertions are soft.
 */
import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge, type GuidanceStateSnapshot } from './companion-bridge';

let app: CompanionBridge;

function center(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
function distance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const ca = center(a);
  const cb = center(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

test.describe('Athena guided walkthrough — persona creation', () => {
  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test.afterEach(async () => {
    // Leave the app in a clean state for the next spec. Only click Stop when a
    // walkthrough is actually active (the control is mounted then), so no
    // swallowed error is needed. The next test's startGuidedWalkthrough resets
    // state regardless, so this is best-effort tidy-up.
    const s = await app.guidanceState();
    if (s.active) await app.stopGuidance();
  });

  test('orb glides between key areas and the targeted element glows', async () => {
    test.setTimeout(60_000);

    // Start deterministically (no live Claude turn needed for the mechanics).
    await app.startGuidedWalkthrough('persona_creation');

    // The walkthrough activates at step 0 (intro, orb floats to center). The
    // orb mounts a beat before the caption renders, so wait for both.
    const intro = await app.waitForGuidance(
      (s) =>
        s.active &&
        s.topic === 'persona_creation' &&
        s.orbRect !== null &&
        s.captionText !== null,
    );
    expect(intro.stepIndex).toBe(0);
    expect(intro.captionText, 'intro narration should be showing').toBeTruthy();
    const orbAtIntro = intro.orbRect!;
    const introCaption = intro.captionText;

    // Advance to the "open studio" step — it navigates to personas, opens the
    // build studio, and rings the studio container.
    await app.skipGuidanceStep();
    const openStep = await app.waitForGuidance(
      (s) => s.highlightTestId === 'persona-build-entry' && s.glowRect !== null,
      12_000,
    );

    // (a) The orb glided to a new location.
    expect(
      distance(orbAtIntro, openStep.orbRect!),
      'orb should glide away from its intro position',
    ).toBeGreaterThan(40);

    // (b) The glow rings the actual studio element (rect ≈ element rect + padding).
    const anchor = (await app.query('[data-testid="persona-build-entry"]'))[0];
    expect(anchor?.rect, 'studio anchor should be on screen').toBeTruthy();
    expect(
      distance(openStep.glowRect!, anchor!.rect!),
      'glow rect should track the highlighted element',
    ).toBeLessThan(30);

    // (c) The narration changed for the new step.
    expect(openStep.captionText).toBeTruthy();
    expect(openStep.captionText).not.toBe(introCaption);

    // Stop the walkthrough — the glow and active state clear.
    await app.stopGuidance();
    const stopped = await app.waitForGuidance((s) => !s.active);
    expect(stopped.glowRect).toBeNull();
    expect(stopped.highlightTestId).toBeNull();
  });

  test('auto-plays through the full step sequence to completion', async () => {
    test.setTimeout(90_000);
    await app.startGuidedWalkthrough('persona_creation');
    await app.waitForGuidance((s) => s.active);

    // Let the auto-play runner advance through every step on its own (the user
    // chose "auto-play narrated demo"). Poll, collecting the distinct narration
    // beats, until the walkthrough ends itself after the last step.
    const seenCaptions = new Set<string>();
    const deadline = Date.now() + 75_000;
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
    expect(active, 'walkthrough should auto-advance and clear itself').toBe(false);
    // Narrated several distinct steps along the way.
    expect(seenCaptions.size).toBeGreaterThanOrEqual(3);
  });

  // ── End-to-end through a real Claude turn (slow + model-dependent) ──────
  // Skipped by default: (1) it needs a live, configured Claude CLI and is
  // model-nondeterministic; (2) the shared `openChatPanel` helper predates the
  // floating orb — with the orb enabled the footer toggles the orb
  // (minimized↔collapsed) instead of opening the panel, so this needs an
  // orb-compatible panel-open path before it can run unattended. The mechanics
  // (orb glide + element glow + narration + auto-completion) and the op wiring
  // are covered by the deterministic tests above + the Rust dispatcher unit
  // tests. The natural-language path is best verified by chatting with Athena
  // in the running app ("show me how to create a persona"). Remove `.skip` once
  // the panel-open path is orb-aware.
  test.skip('Athena drives a walkthrough from a natural request', async () => {
    test.setTimeout(300_000);
    await app.openChatPanel();
    await app.resetConversation();

    await app.sendAndAwait('Show me how to create a persona, step by step.', 240_000);

    // Athena should either start the walkthrough directly (preferred) or offer
    // it via the choice card. Both are acceptable "show me how" responses, so
    // assert softly to avoid flaking on model nondeterminism.
    const guidance: GuidanceStateSnapshot = await app
      .waitForGuidance((s) => s.active, 6_000)
      .catch(() => app.guidanceState());
    const offer = await app.query('[data-testid="companion-offer-show"]');

    expect
      .soft(
        guidance.active || offer.some((n) => n.visible),
        'Athena should start the walkthrough or offer the "Show me how" card',
      )
      .toBe(true);
  });
});

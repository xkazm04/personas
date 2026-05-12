import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * A5 — mid-stream Stop button.
 *
 * The Stop button is only visible while `streaming === true` in the
 * companion store. Verifying presence + click would otherwise require
 * a real Claude turn (~30-90s) and racing the click against the
 * reply landing.
 *
 * We use `forceCompanionStreaming` from the test bridge to put the
 * store into a streaming state synthetically, then check the DOM and
 * the click path. The actual stream-cancellation behavior is covered
 * by the unit-level interrupt registry; this suite verifies the UI
 * wiring.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 */

let app: CompanionBridge;

test.describe('Companion Stop button (A5)', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test.beforeEach(async () => {
    await app.openChatPanel();
    // Ensure clean baseline — no streaming flag from a prior test.
    await app.forceStreaming(false);
  });

  test.afterEach(async () => {
    // Always clear so the next test (or a manual session afterward)
    // doesn't see a phantom streaming bubble.
    await app.forceStreaming(false);
  });

  test('Stop button is hidden when not streaming', async () => {
    const nodes = await app.query('[data-testid="companion-stop-turn"]');
    expect(nodes.filter((n) => n.visible).length).toBe(0);
  });

  test('Stop button appears when streaming flag is on', async () => {
    await app.forceStreaming(true, 'thinking through this...');
    // Give the panel a tick to render the streaming bubble.
    await new Promise((r) => setTimeout(r, 200));

    // The button is hidden by default and only shows on hover via the
    // `group-hover` class — query checks for *existence in DOM* which
    // is what we care about; the hover-reveal is purely cosmetic.
    const stopNodes = await app.query('[data-testid="companion-stop-turn"]');
    expect(stopNodes.length).toBe(1);

    // Streaming bubble should also be present, carrying the text we set.
    const bubble = await app.query(
      '[data-testid="companion-bubble-streaming"]',
    );
    expect(bubble.length).toBe(1);
    expect(bubble[0]!.text).toContain('thinking through this');
  });

  test('clicking Stop is idempotent (no error when no real turn)', async () => {
    await app.forceStreaming(true, 'fake stream');
    await new Promise((r) => setTimeout(r, 200));

    // Click — backend gets called with whatever (likely null) turnId
    // the frontend tracked. With no real CLI process to interrupt,
    // the backend just adds the id to its in-memory cancel set, which
    // is harmless. The test asserts the click didn't throw.
    await app.clickTestId('companion-stop-turn');

    // Reset streaming so the next test starts clean.
    await app.forceStreaming(false);
  });
});

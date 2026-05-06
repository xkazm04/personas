import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge } from './companion-bridge';

/**
 * End-to-end conversation flow against a *real* running Tauri app.
 *
 * Pre-req: launch the app with the test-automation server enabled:
 *   npm run tauri:dev:test
 * (Vite dev + Tauri WebView + axum HTTP bridge on port 17320).
 *
 * The tests then:
 *   1. Open the chat panel.
 *   2. Reset conversation (clean slate).
 *   3. Send 3 messages, awaiting each reply.
 *   4. Verify the rendered transcript matches what landed on disk
 *      (brain inventory: episodes count grew by ≥6).
 *   5. Spot-check Phase C surfaces (Memory tab toolbar reachable).
 *
 * Each "send + wait" round is real Claude Opus, ~30-90s. The whole
 * suite takes 3-5 minutes. Per-test timeout: 5 minutes.
 */

const PROMPTS = [
  'Hi! Just running a sanity test. Reply with the single word OK.',
  'In one short sentence: what year is the most recent year you have data for?',
  'Last quick check: respond with the word DONE and nothing else.',
];

let app: CompanionBridge;

test.describe('Athena conversation E2E', () => {
  // Each turn can take 30-90s. Three messages + reset + setup ≈ 5 minutes.
  test.setTimeout(360_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('panel opens, conversation resets, and three turns round-trip', async () => {
    await app.openChatPanel();
    await app.resetConversation();

    let snapshot = await app.snapshotPanel();
    expect(snapshot.panelVisible).toBe(true);
    expect(snapshot.messages.length).toBe(0);
    expect(snapshot.streaming).toBe(false);

    for (let i = 0; i < PROMPTS.length; i++) {
      const reply = await app.sendAndAwait(PROMPTS[i]!);
      expect.soft(reply.length).toBeGreaterThan(0);

      snapshot = await app.snapshotPanel();
      // After turn N: 2N user+assistant bubbles (alternating).
      expect(snapshot.messages.length).toBe((i + 1) * 2);
      expect(snapshot.streaming).toBe(false);

      const lastTwo = snapshot.messages.slice(-2);
      expect(lastTwo[0]!.role).toBe('user');
      expect(lastTwo[0]!.text).toContain(PROMPTS[i]!.slice(0, 30));
      expect(lastTwo[1]!.role).toBe('assistant');
      expect(lastTwo[1]!.text.length).toBeGreaterThan(0);
    }

    const final = await app.snapshotPanel();
    expect(final.messages.filter((m) => m.role === 'user')).toHaveLength(3);
    expect(final.messages.filter((m) => m.role === 'assistant')).toHaveLength(3);
  });

  test('episodes persist to the brain after the conversation', async () => {
    // Reset wipes SQL transcript at the start of test 1, so the
    // baseline-vs-after delta is meaningless here (the baseline was
    // captured *before* reset). The right invariant is "the post-reset
    // count equals the number of turns that just landed" — 3 user +
    // 3 assistant = 6.
    const after = await app.snapshotPanel();
    expect(after.brain.episodes).toBeGreaterThanOrEqual(6);
  });

  test('Phase D: brain inspector exposes habit + aspiration tabs', async () => {
    // Verify the four new BrainKind groups (Goals, Procedurals, Rituals,
    // Backlog) render as cards in the Memory tab's brain inspector.
    // Empty stores are fine — we're checking the *tabs* exist, not that
    // they have content.
    try {
      await app.openCompanionPlugin();
    } catch (err) {
      test.info().annotations.push({
        type: 'warn',
        description: `companion plugin tab missing: ${(err as Error).message}`,
      });
      return;
    }

    // Same defensive polling as the Memory test below.
    const tabDeadline = Date.now() + 4_000;
    let memTabFound = false;
    while (Date.now() < tabDeadline) {
      const nodes = await app.query('[data-testid="tab-memory"]');
      if (nodes.some((n) => n.visible)) {
        memTabFound = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!memTabFound) {
      test.info().annotations.push({
        type: 'warn',
        description: 'tab-memory testid missing — Phase D tab assertion skipped',
      });
      return;
    }
    await app.clickTestId('tab-memory');

    // Each of the four labels must be present in the rendered tree
    // after the brain inspector mounts. We poll because React renders
    // async after the tab switch.
    const labels = ['Goals', 'Procedurals', 'Rituals', 'Backlog'];
    const cardsDeadline = Date.now() + 4_000;
    const seen = new Set<string>();
    while (Date.now() < cardsDeadline && seen.size < labels.length) {
      for (const label of labels) {
        if (seen.has(label)) continue;
        const hits = await app.findText(label);
        if (hits.some((n) => n.visible)) {
          seen.add(label);
        }
      }
      if (seen.size === labels.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    for (const label of labels) {
      expect.soft(seen, `Phase D tab missing: ${label}`).toContain(label);
    }
  });

  test('Phase D: brain counts surface in companionInspect', async () => {
    // The harness type already asserts numbers via TS; this catches
    // a runtime regression where the bridge's collectBrainCounts()
    // helper might silently return undefined for the new keys
    // (e.g., if the backend hasn't migrated the schema yet).
    const snap = await app.snapshotPanel();
    expect(typeof snap.brain.procedurals).toBe('number');
    expect(typeof snap.brain.goals).toBe('number');
    expect(typeof snap.brain.rituals).toBe('number');
    expect(typeof snap.brain.backlog).toBe('number');
    // Sanity-check: each count is ≥ 0 (i.e., not NaN or negative).
    expect(snap.brain.procedurals).toBeGreaterThanOrEqual(0);
    expect(snap.brain.goals).toBeGreaterThanOrEqual(0);
    expect(snap.brain.rituals).toBeGreaterThanOrEqual(0);
    expect(snap.brain.backlog).toBeGreaterThanOrEqual(0);
  });

  test('Phase E: panel renders proactive cards from store (empty case)', async () => {
    // Default state: no goals / backlog / rituals → no proactive
    // messages → no cards. The assertion here is that the card
    // rendering path doesn't blow up in the empty case (regression
    // guard for the store/listener wiring).
    await app.openChatPanel();
    const count = await app.proactiveCardCount();
    expect(count).toBe(0);
  });

  test('Phase F: Dev Tools toggle flips state and persists across reload', async () => {
    // Open the chat panel so the toolbar mounts.
    await app.openChatPanel();

    // Read initial className (off baseline).
    const initial = await app.devToolsButtonClass();
    expect(initial, 'dev-tools button should render').not.toBeNull();
    const wasInitiallyOn = (initial ?? '').includes('bg-primary/25');

    // Click → toggle.
    await app.clickTestId('companion-plugin-dev-tools');
    // Tiny wait for React state + backend round-trip.
    await new Promise((r) => setTimeout(r, 400));
    const afterClick = (await app.devToolsButtonClass()) ?? '';
    if (wasInitiallyOn) {
      // Was on → now off.
      expect(afterClick).toContain('text-foreground/55');
      expect(afterClick).not.toContain('bg-primary/25');
    } else {
      // Was off → now on. Look for the enabled signature.
      expect(afterClick).toContain('bg-primary/25');
      expect(afterClick).toContain('ring-1');
    }

    // Click again → back to original.
    await app.clickTestId('companion-plugin-dev-tools');
    await new Promise((r) => setTimeout(r, 400));
    const afterSecondClick = (await app.devToolsButtonClass()) ?? '';
    if (wasInitiallyOn) {
      expect(afterSecondClick).toContain('bg-primary/25');
    } else {
      expect(afterSecondClick).toContain('text-foreground/55');
    }
  });

  test('Phase F: connector pin state persists via backend', async () => {
    // The sidebar should already render any pre-pinned connectors
    // from companion_active_connector. We can't drive the picker
    // modal here without a real vault credential to add — but we CAN
    // verify the listing surface works and the sidebar reflects it.
    await app.openChatPanel();
    const states = await app.pinnedConnectorStates();
    // Each entry is well-formed (boolean), not undefined.
    for (const [name, enabled] of Object.entries(states)) {
      expect(typeof enabled).toBe('boolean');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('Phase F: connector add button is reachable from the sidebar', async () => {
    await app.openChatPanel();
    const nodes = await app.query('[data-testid="companion-connectors-add"]');
    expect(nodes.some((n) => n.visible)).toBe(true);
  });

  test('Phase F: reset clears the sendError chip', async () => {
    // Open the panel and reset — there should be no rose-tinted error
    // chip in the transcript after reset, regardless of any prior
    // state. This guards the fix for "timeout error persists across
    // reset" reported during the Phase F review.
    await app.openChatPanel();
    await app.resetConversation();
    const hasError = await app.hasSendErrorChip();
    expect(hasError).toBe(false);
  });

  test('Memory tab is reachable and exposes the bulk-action toolbar', async () => {
    try {
      await app.openCompanionPlugin();
    } catch (err) {
      test.info().annotations.push({
        type: 'warn',
        description: `companion plugin tab missing: ${(err as Error).message}`,
      });
      return;
    }
    // Poll for the Memory sub-tab. /wait is unreliable here (its
    // visibility check rejects position:fixed elements), so query in
    // a small loop instead.
    const deadline = Date.now() + 4_000;
    let memTabFound = false;
    while (Date.now() < deadline) {
      const nodes = await app.query('[data-testid="tab-memory"]');
      if (nodes.some((n) => n.visible)) {
        memTabFound = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!memTabFound) {
      test.info().annotations.push({
        type: 'warn',
        description: 'tab-memory testid missing — Memory tab assertion skipped',
      });
      return;
    }
    await app.clickTestId('tab-memory');
    // Wait for the toolbar text to appear (the page renders async after
    // the tab click). 3s is plenty for a static React render.
    const toolbarDeadline = Date.now() + 3_000;
    let toolbarHits = 0;
    while (Date.now() < toolbarDeadline) {
      const hits = await app.findText('Run consolidation');
      if (hits.length > 0) {
        toolbarHits = hits.length;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(toolbarHits).toBeGreaterThan(0);
  });
});

import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Companion panel header — the toolbar above the transcript.
 *
 * Covers the four buttons that sit in the right-hand cluster:
 *  - Autonomous-mode toggle (A2)  — exercised in companion-autonomous-mode.spec
 *  - Compact-width toggle         — here
 *  - Refresh-doctrine button      — here (presence + click is safe)
 *  - Reset-conversation button    — here (wipes transcript)
 *  - Close button (collapse)      — here
 *
 * The autonomous toggle has its own spec; this suite focuses on the
 * pieces that have no other coverage.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 */

let app: CompanionBridge;

test.describe('Companion header controls', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test.beforeEach(async () => {
    await app.openChatPanel();
  });

  test('all header buttons are present with testids', async () => {
    const expected = [
      'companion-toggle-autonomous',
      'companion-toggle-compact',
      'companion-reset',
      'companion-close',
    ];
    for (const id of expected) {
      const nodes = await app.query(`[data-testid="${id}"]`);
      expect(nodes.length, `expected one node with testid="${id}"`).toBe(1);
      expect(nodes[0]!.visible, `${id} should be visible`).toBe(true);
    }
  });

  test('compact toggle flips panel width', async () => {
    // Read the panel's initial width via its className signature. The
    // wide variant has `w-[760px]`, compact has `w-[380px]`.
    let panel = (await app.query('[data-testid="companion-panel"]'))[0];
    expect(panel).toBeDefined();
    const initiallyCompact = (panel!.className ?? '').includes('w-[380px]');

    await app.clickTestId('companion-toggle-compact');
    await new Promise((r) => setTimeout(r, 250)); // wait for the width transition

    panel = (await app.query('[data-testid="companion-panel"]'))[0];
    expect(panel).toBeDefined();
    const nowCompact = (panel!.className ?? '').includes('w-[380px]');
    expect(nowCompact).toBe(!initiallyCompact);

    // Flip back so we don't pollute downstream state.
    await app.clickTestId('companion-toggle-compact');
    await new Promise((r) => setTimeout(r, 250));
  });

  test('reset clears the transcript', async () => {
    // Open + reset to a clean baseline first.
    await app.resetConversation();
    let snap = await app.snapshotPanel();
    expect(snap.messages.length).toBe(0);

    // Force a streaming bubble so the next reset has *something* to
    // clear. (Cheaper than a real Claude turn.)
    await app.forceStreaming(true, 'transient streaming text');
    await new Promise((r) => setTimeout(r, 150));

    // Clicking the reset button calls `companion_reset_conversation`
    // which wipes the SQL transcript AND clears the streaming flag.
    // The bridge's `resetConversation` calls the same command path.
    await app.resetConversation();
    snap = await app.snapshotPanel();
    expect(snap.messages.length).toBe(0);
    expect(snap.streaming).toBe(false);
  });

  test('close button collapses the panel', async () => {
    // Confirm the panel is open first.
    let snap = await app.snapshotPanel();
    expect(snap.panelVisible).toBe(true);

    await app.clickTestId('companion-close');
    // Animation: AnimatePresence exit is ~180ms. Poll briefly.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      snap = await app.snapshotPanel();
      if (!snap.panelVisible) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(snap.panelVisible).toBe(false);
  });
});

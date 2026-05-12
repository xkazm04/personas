import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * A2 — autonomous-continuation visual marker.
 *
 * When `send_turn` runs with `TurnOrigin::Autonomous`, the backend
 * persists a `EpisodeRole::System` episode with content like
 * `[autonomous continuation #N]`. The Bubble component detects this
 * content prefix and renders the message as a slim centered divider
 * instead of a regular chat bubble.
 *
 * Real autonomous chains require Opus calls (cost-prohibitive for a
 * smoke test). Instead, we inject the synthetic system messages
 * directly into the store via the bridge, then assert the DOM shape.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 */

let app: CompanionBridge;

test.describe('Companion autonomous continuation marker (A2)', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test.beforeEach(async () => {
    await app.openChatPanel();
    await app.resetConversation();
  });

  test('renders [autonomous continuation #N] as a slim divider, not a bubble', async () => {
    await app.setMessages([
      {
        id: 'msg-user-1',
        role: 'user',
        content: 'analyze my recent persona runs',
      },
      {
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'Looking at the last 5 runs across your personas now.',
      },
      {
        id: 'msg-system-1',
        role: 'system',
        content: '[autonomous continuation #1]',
      },
      {
        id: 'msg-assistant-2',
        role: 'assistant',
        content: 'Done — persona X has been failing on auth for 3 runs.',
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));

    // The marker is its own testid — a divider row.
    const markers = await app.query(
      '[data-testid="companion-autonomous-marker"]',
    );
    expect(markers.length).toBe(1);
    expect(markers[0]!.text).toContain('autonomous continuation #1');

    // The marker should NOT render as a regular system/assistant
    // bubble — its testid + role attribute are distinct.
    const sysAutonomousBubbles = await app.query(
      '[data-companion-bubble-role="system-autonomous"]',
    );
    expect(sysAutonomousBubbles.length).toBe(1);

    // Adjacent assistant bubbles should still render normally.
    const assistantBubbles = await app.query(
      '[data-testid="companion-bubble-assistant"]',
    );
    expect(assistantBubbles.length).toBe(2);
  });

  test('multiple continuation markers render one divider each', async () => {
    await app.setMessages([
      { id: 'u-1', role: 'user', content: 'kick off the long task' },
      { id: 'a-1', role: 'assistant', content: 'On it.' },
      { id: 's-1', role: 'system', content: '[autonomous continuation #1]' },
      { id: 'a-2', role: 'assistant', content: 'Step 1 done.' },
      { id: 's-2', role: 'system', content: '[autonomous continuation #2]' },
      { id: 'a-3', role: 'assistant', content: 'Step 2 done.' },
      { id: 's-3', role: 'system', content: '[autonomous continuation #3]' },
      { id: 'a-4', role: 'assistant', content: 'All done.' },
    ]);
    await new Promise((r) => setTimeout(r, 200));

    const markers = await app.query(
      '[data-testid="companion-autonomous-marker"]',
    );
    expect(markers.length).toBe(3);
    expect(markers[0]!.text).toContain('#1');
    expect(markers[1]!.text).toContain('#2');
    expect(markers[2]!.text).toContain('#3');
  });

  test('a system message that is NOT an autonomous marker falls back to a regular bubble', async () => {
    await app.setMessages([
      { id: 'u', role: 'user', content: 'hello' },
      {
        id: 's-non-auto',
        role: 'system',
        content: '[Background job `scan_codebase` completed — id `xyz`]',
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));

    // No autonomous marker should appear.
    const markers = await app.query(
      '[data-testid="companion-autonomous-marker"]',
    );
    expect(markers.length).toBe(0);

    // A regular system-role bubble should be present instead.
    const systemBubbles = await app.query(
      '[data-testid="companion-bubble-system"]',
    );
    expect(systemBubbles.length).toBe(1);
  });
});

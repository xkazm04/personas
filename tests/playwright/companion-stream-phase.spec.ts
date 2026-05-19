import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge } from './companion-bridge';

/**
 * Stream-phase indicator behavior (synthetic — no real Claude).
 *
 * Regression guard for the 2026-05-19 fix where the chat bubble got
 * stuck on "Connecting…" forever because the Claude CLI emits a
 * `type: system` line at session start and nothing else until 5-20s
 * later when the model warms up. The old mapping kept "Connecting…"
 * visible for the entire pre-text wait. Now `system` is dropped from
 * the phase extractor, falling through to the bubble's default
 * "Thinking…" placeholder — which is accurate while we wait for
 * the model.
 *
 * Uses the `forceCompanionStreaming` test-automation bridge to drive
 * the streaming bubble + streamingPhase directly; no real CLI invoked.
 *
 * Pre-req: launch the app with
 *   npm run tauri:dev:test
 * (Vite dev + Tauri WebView + axum HTTP bridge on port 17320).
 */

const STREAMING_BUBBLE = '[data-testid="companion-bubble-streaming"]';

let app: CompanionBridge;

async function streamingBubbleText(b: CompanionBridge): Promise<string> {
  const nodes = await b.query(STREAMING_BUBBLE);
  // Bubble innerText is one of the phase strings or the streaming text.
  return nodes[0]?.text?.trim() ?? '';
}

test.describe('Companion stream-phase indicator (synthetic)', () => {
  test.setTimeout(30_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test.beforeEach(async () => {
    await app.openChatPanel();
    // Hard reset between tests so previous synthetic state doesn't bleed.
    await app.forceStreaming(false);
  });

  test.afterEach(async () => {
    await app.forceStreaming(false);
  });

  test('default placeholder is "Thinking…" — no "Connecting…" leak', async () => {
    // Fresh stream, no phase, no text. This is the state right after a
    // user sends a message — before any CLI line arrives.
    await app.forceStreaming(true, undefined, null);
    const text = await streamingBubbleText(app);
    expect(text).toBe('Thinking…');
    expect(text.toLowerCase()).not.toContain('connecting');
  });

  test('tool_use phase with Read tool renders "Reading files…"', async () => {
    await app.forceStreaming(true, undefined, { kind: 'tool_use', toolName: 'Read' });
    expect(await streamingBubbleText(app)).toBe('Reading files…');
  });

  test('tool_use phase with WebSearch renders "Searching the web…"', async () => {
    await app.forceStreaming(true, undefined, {
      kind: 'tool_use',
      toolName: 'WebSearch',
    });
    expect(await streamingBubbleText(app)).toBe('Searching the web…');
  });

  test('tool_use phase with Bash renders "Running a command…"', async () => {
    await app.forceStreaming(true, undefined, { kind: 'tool_use', toolName: 'Bash' });
    expect(await streamingBubbleText(app)).toBe('Running a command…');
  });

  test('tool_use phase with Task (subagent) renders "Asking a subagent…"', async () => {
    await app.forceStreaming(true, undefined, { kind: 'tool_use', toolName: 'Task' });
    expect(await streamingBubbleText(app)).toBe('Asking a subagent…');
  });

  test('reviewing phase renders "Reviewing result…"', async () => {
    await app.forceStreaming(true, undefined, { kind: 'reviewing' });
    expect(await streamingBubbleText(app)).toBe('Reviewing result…');
  });

  test('thinking phase renders "Thinking…"', async () => {
    await app.forceStreaming(true, undefined, { kind: 'thinking' });
    expect(await streamingBubbleText(app)).toBe('Thinking…');
  });

  test('streaming text takes precedence over phase', async () => {
    // When real prose arrives the phase should be cleared by the
    // CompanionPanel stream handler, but forceStreaming lets us seed
    // both at once — assert the bubble shows the text, not the phase.
    await app.forceStreaming(true, 'Hello, world!', {
      kind: 'tool_use',
      toolName: 'Read',
    });
    const text = await streamingBubbleText(app);
    expect(text).toContain('Hello, world!');
    expect(text).not.toContain('Reading files');
  });

  test('unknown tool falls through to "Using {tool}…" template', async () => {
    await app.forceStreaming(true, undefined, {
      kind: 'tool_use',
      toolName: 'WidgetMaker',
    });
    expect(await streamingBubbleText(app)).toBe('Using WidgetMaker…');
  });
});

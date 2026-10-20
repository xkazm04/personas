import { describe, it, expect, afterEach, vi } from 'vitest';
import { CompanionBridge } from '../companion-bridge';

/**
 * CompanionBridge drives a running app over HTTP, so the live specs cannot run
 * per PR. This fake models the app's REAL behaviour for the few endpoints a
 * helper uses, so a helper that cannot work against the product goes red here
 * instead of in a beforeEach nobody runs:
 *  - footer-companion with the orb enabled (athenaOrbEnabled defaults true,
 *    athenaSlice.ts) toggles minimized <-> collapsed; it never opens the chat
 *    (AthenaFooterIcon.tsx onClick).
 *  - bridge `openCompanion` sets the lifecycle state to 'open' (bridge.ts).
 *  - the failed-turn chip renders the registry-TRANSLATED message plus a
 *    `companion-retry-send` button (AthenaChatErrorNotice.tsx).
 */
type Node = { tag: string; text: string; id: null; testId: string | null; visible: boolean; className?: string };

function fakeApp(opts: { orbEnabled: boolean; sendError?: string | null }) {
  let state: 'minimized' | 'collapsed' | 'open' = 'collapsed';
  const calls: string[] = [];
  const panel = () => ({
    panelVisible: state === 'open',
    streaming: false,
    messages: [],
    streamingText: null,
    approvals: 0,
    brain: { episodes: 0, reflections: 0, facts: { user: 0, project: 0, world: 0 }, procedurals: 0, goals: 0, rituals: 0, backlog: 0 },
  });
  const chipNodes = (): Node[] =>
    opts.sendError && state === 'open'
      ? [
          { tag: 'div', text: `${opts.sendError}Retry`, id: null, testId: null, visible: true, className: 'rounded-card text-rose-400' },
          { tag: 'button', text: 'Retry', id: null, testId: 'companion-retry-send', visible: true, className: 'text-rose-400' },
        ]
      : [];
  const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : {};
    let out: unknown = { success: true };
    if (path === '/click-testid') {
      calls.push(`click:${body.test_id}`);
      if (body.test_id === 'footer-companion') {
        if (opts.orbEnabled) state = state === 'minimized' ? 'collapsed' : 'minimized';
        else state = state === 'open' ? 'collapsed' : 'open';
      }
    } else if (path === '/bridge-exec') {
      calls.push(`exec:${body.method}`);
      if (body.method === 'openCompanion') {
        state = 'open';
        out = JSON.stringify({ success: true });
      } else if (body.method === 'companionInspect') {
        out = JSON.stringify(panel());
      } else {
        out = JSON.stringify({ error: `unknown method ${body.method}` });
      }
    } else if (path === '/query') {
      const sel: string = body.selector;
      const nodes = chipNodes();
      if (sel === '.text-rose-400') out = nodes;
      else if (sel.includes('companion-retry-send')) out = nodes.filter((n) => n.testId === 'companion-retry-send');
      else out = [];
    }
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
  });
  return { fetchImpl, calls };
}

describe('CompanionBridge against the app it drives', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('openChatPanel', () => {
    it.each([true, false])('opens the chat panel with the orb %s', async (orbEnabled) => {
      const app = fakeApp({ orbEnabled });
      vi.stubGlobal('fetch', app.fetchImpl);
      const bridge = new CompanionBridge('http://127.0.0.1:1');
      await bridge.openChatPanel(400);
      const state = await bridge.snapshotPanel();
      expect(state.panelVisible).toBe(true);
    });
  });

  describe('hasSendErrorChip', () => {

    it('sees a chip whose translated message names neither "failed" nor "timed out"', async () => {
      // resolveErrorTranslated maps an unclassified error to the generic copy.
      const app = fakeApp({ orbEnabled: false, sendError: 'Something went wrong.' });
      vi.stubGlobal('fetch', app.fetchImpl);
      const bridge = new CompanionBridge('http://127.0.0.1:1');
      await bridge.openChatPanel(400);
      expect(await bridge.hasSendErrorChip()).toBe(true);
    });

    it('reports no chip when none is rendered', async () => {
      const app = fakeApp({ orbEnabled: false, sendError: null });
      vi.stubGlobal('fetch', app.fetchImpl);
      const bridge = new CompanionBridge('http://127.0.0.1:1');
      await bridge.openChatPanel(400);
      expect(await bridge.hasSendErrorChip()).toBe(false);
    });
  });
});

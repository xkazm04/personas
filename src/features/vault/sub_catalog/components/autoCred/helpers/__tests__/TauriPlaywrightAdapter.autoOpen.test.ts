import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The `auto-cred-open-url` path opens a URL with no click, and the URL comes
 * from a model reading arbitrary web pages. It must pass the same
 * `sanitizeExternalUrl` the click paths apply before reaching the OS.
 */

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, h: Handler) => {
    handlers.set(name, h);
    return () => handlers.delete(name);
  }),
}));

const openExternalUrl = vi.fn(async (_url: string) => {});
vi.mock('@/api/system/system', () => ({ openExternalUrl: (u: string) => openExternalUrl(u) }));

let emitDuringRun: (() => void) | null = null;
vi.mock('@/api/vault/autoCredBrowser', () => ({
  getPlaywrightProcedure: vi.fn(async () => null),
  cancelAutoCredBrowser: vi.fn(async () => {}),
  startAutoCredBrowser: vi.fn(async () => {
    emitDuringRun?.();
    return { extracted_values: {}, partial: false };
  }),
}));

import { TauriPlaywrightAdapter } from '../TauriPlaywrightAdapter';
import type { AutoCredConnectorContext, BrowserLogEntry } from '../types';

const ctx = {
  connector: { name: 'acme', label: 'Acme', fields: [] },
  docsUrl: null,
  setupInstructions: null,
  fields: [],
} as unknown as AutoCredConnectorContext;

/** Run one session, emitting `url` on the open-url channel mid-run. */
async function runWithOpenUrl(url: string) {
  const logs: BrowserLogEntry[] = [];
  const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
  emitDuringRun = () => {
    handlers.get('auto-cred-open-url')?.({ payload: { session_id: '00000000-0000-4000-8000-000000000001', url } });
  };
  await new TauriPlaywrightAdapter().run(ctx, (e) => logs.push(e), new AbortController().signal);
  uuid.mockRestore();
  return logs;
}

describe('TauriPlaywrightAdapter: auto-opened URLs are sanitized', () => {
  beforeEach(() => {
    openExternalUrl.mockClear();
    handlers.clear();
  });

  it('opens a plain https URL', async () => {
    await runWithOpenUrl('https://example.com/settings/tokens');
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/settings/tokens');
  });

  it.each([
    ['embedded credentials', 'https://user:pass@example.com/'],
    ['a bidi override hiding the host', 'https://example.com\u202e/moc.live'],
    ['a non-http scheme', 'file:///C:/Windows/System32/calc.exe'],
  ])('refuses %s and does not echo it', async (_label, url) => {
    const logs = await runWithOpenUrl(url);
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(logs.some((l) => l.type === 'error')).toBe(true);
    expect(logs.some((l) => l.message.includes(url))).toBe(false);
  });
});

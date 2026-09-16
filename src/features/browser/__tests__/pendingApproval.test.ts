import { describe, expect, it } from 'vitest';

import { pendingBrowserTabId } from '../webview/PendingApprovalBar';

/** The exact shape `decision/useDecisionQueue.ts` builds for an approval. */
const payload = (action: string, params: unknown) =>
  JSON.stringify({ action, params: JSON.stringify(params), created_at: '2026-09-16T00:00:00Z' });

describe('pendingBrowserTabId', () => {
  it('reads the tab a browser write is waiting on', () => {
    expect(pendingBrowserTabId(payload('browser_act', { tab_id: 3, ref: 'e7' }))).toBe(3);
    expect(pendingBrowserTabId(payload('browser_login', { tab_id: 1 }))).toBe(1);
  });

  it('ignores approvals that are not about the browser', () => {
    expect(pendingBrowserTabId(payload('run_persona', { tab_id: 3 }))).toBeNull();
  });

  it('is null rather than throwing on anything malformed', () => {
    expect(pendingBrowserTabId(undefined)).toBeNull();
    expect(pendingBrowserTabId('')).toBeNull();
    expect(pendingBrowserTabId('not json')).toBeNull();
    expect(pendingBrowserTabId(JSON.stringify({ action: 'browser_act' }))).toBeNull();
    expect(pendingBrowserTabId(payload('browser_act', { tab_id: 'three' }))).toBeNull();
    expect(pendingBrowserTabId(payload('browser_act', null))).toBeNull();
  });
});

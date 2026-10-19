import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';

let failList = true;
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((cmd: string, args?: { memoryId?: string }) => {
    if (cmd !== 'list_memory_claims') return Promise.resolve(null);
    if (failList) return Promise.reject({ error: 'database is locked', kind: 'Database' });
    return Promise.resolve(args?.memoryId === 'mem-a'
      ? [{ id: 'c1', memory_id: 'mem-a', verdict: 'wrong', note: null, resolution: null, created_at: new Date().toISOString() }]
      : new Promise(() => {}));
  }),
}));

import { MemoryClaimsSection } from '../MemoryClaimsSection';

describe('MemoryClaimsSection read states', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it('a failed claims read does not claim "no disputes"', async () => {
    failList = true;
    render(<MemoryClaimsSection memoryId="mem-a" />);
    const { invokeWithTimeout } = await import('@/lib/tauriInvoke');
    await waitFor(() => expect(invokeWithTimeout).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(en.overview.memory_detail.claims_empty)).toBeNull();
  });

  it("another memory's open claims never drive this memory's resolve buttons", async () => {
    failList = false;
    const { rerender } = render(<MemoryClaimsSection memoryId="mem-a" />);
    await screen.findByText(en.overview.memory_detail.claim_resolve_deprecate);
    rerender(<MemoryClaimsSection memoryId="mem-b" />);
    expect(screen.queryByText(en.overview.memory_detail.claim_resolve_deprecate)).toBeNull();
  });
});

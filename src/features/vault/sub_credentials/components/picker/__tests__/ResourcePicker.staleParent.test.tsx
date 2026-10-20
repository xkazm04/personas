import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ResourceSpec } from '@/lib/types/types';

/**
 * Re-picking a parent while the dependent spec's fetch is in flight: the older
 * response resolves last and must not paint the previous parent's items.
 */
const pending: Record<string, (items: unknown[]) => void> = {};
vi.mock('@/api/credentials/scopedResources', () => ({
  listConnectorResources: vi.fn((_cred: string, specId: string, ctx: Record<string, { id: string }>) => {
    if (specId === 'repos') {
      return Promise.resolve([
        { id: 'A', label: 'repoA' },
        { id: 'B', label: 'repoB' },
      ]);
    }
    return new Promise((resolve) => {
      pending[ctx.repos!.id] = resolve;
    });
  }),
  saveScopedResources: vi.fn(),
}));

import { ResourcePicker } from '../ResourcePicker';

const specs = [
  { id: 'repos', label: 'Repositories', selection: 'single' },
  { id: 'branches', label: 'Branches', selection: 'multi', depends_on: ['repos'] },
] as ResourceSpec[];

describe('ResourcePicker stale parent response', () => {
  it('drops the older parent fetch when it resolves after the newer one', async () => {
    render(<ResourcePicker credentialId="c" connectorLabel="GitHub" specs={specs} onClose={() => {}} />);
    fireEvent.click(await screen.findByText('repoA'));
    await waitFor(() => expect(pending.A).toBeTruthy());
    fireEvent.click(await screen.findByText('repoB'));
    await waitFor(() => expect(pending.B).toBeTruthy());
    await act(async () => {
      pending.B!([{ id: 'b1', label: 'branch-of-B' }]);
    });
    await act(async () => {
      pending.A!([{ id: 'a1', label: 'branch-of-A' }]);
    });
    expect(screen.queryByText('branch-of-A')).toBeNull();
    expect(screen.getByText('branch-of-B')).toBeTruthy();
  });
});

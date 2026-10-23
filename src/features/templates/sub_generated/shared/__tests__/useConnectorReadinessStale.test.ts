import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ConnectorReadinessEntry } from '@/lib/bindings/ConnectorReadinessEntry';

const pending: Array<{ names: string[]; resolve: (v: ConnectorReadinessEntry[]) => void }> = [];
vi.mock('@/api/design/connectorReadiness', () => ({
  connectorReadinessBatch: (names: string[]) =>
    new Promise<ConnectorReadinessEntry[]>((resolve) => { pending.push({ names, resolve }); }),
}));

import { useConnectorReadiness } from '../useConnectorReadiness';

const entry = (connector: string, ready: boolean) => ({ connector, ready, kind: null }) as ConnectorReadinessEntry;

describe('useConnectorReadiness ordering', () => {
  it('never lets a slow earlier response overwrite the newer vocabulary', async () => {
    const { result, rerender } = renderHook(({ names }) => useConnectorReadiness(names), {
      initialProps: { names: ['slack'] },
    });
    rerender({ names: ['slack', 'github'] });
    expect(pending).toHaveLength(2);

    // Newer request lands first, then the stale one.
    await act(async () => { pending[1]!.resolve([entry('slack', true), entry('github', true)]); });
    await act(async () => { pending[0]!.resolve([entry('slack', false)]); });

    expect(result.current.readiness.get('slack')?.health).toBe('ready');
    expect(result.current.readiness.get('github')?.health).toBe('ready');
    expect(result.current.isPending).toBe(false);
  });
});

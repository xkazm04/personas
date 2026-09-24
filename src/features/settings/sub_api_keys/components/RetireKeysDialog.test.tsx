/**
 * RetireKeysDialog revokes credentials, so two things are pinned here:
 *  - the dialog lists exactly the keys it will revoke, and confirming revokes
 *    exactly that list (no more, no fewer);
 *  - a live, non-superseded key (the newest live pairing of an origin, or any
 *    regular key) is never listed and never revoked.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';
import { RetireKeysDialog } from './RetireKeysDialog';
import { retirePlan } from '../libs/keyLifecycle';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function key(id: string, over: Partial<ExternalApiKey> = {}): ExternalApiKey {
  return {
    id,
    name: `Paired ${id}`,
    key_prefix: `pk_${id}`,
    scopes: '[]',
    enabled: true,
    created_at: iso(NOW - 10 * DAY),
    last_used_at: null,
    revoked_at: null,
    expires_at: iso(NOW + 5 * DAY),
    bound_origin: null,
    label: null,
    ...over,
  };
}

const SHIP = 'http://ship-orchestrator.localhost';
const BENCH = 'http://kp-app-master-bench.localhost';

const keys: ExternalApiKey[] = [
  key('regular', { expires_at: null, created_at: iso(NOW - 90 * DAY) }), // stale regular key
  key('ship1', { bound_origin: SHIP, created_at: iso(NOW - 3 * DAY) }),
  key('ship2', { bound_origin: SHIP, created_at: iso(NOW - 2 * DAY) }),
  key('ship3', { bound_origin: SHIP, created_at: iso(NOW - 1 * DAY) }), // current
  key('bench1', { bound_origin: BENCH, expires_at: iso(NOW - 3600_000) }),
  key('bench2', { bound_origin: BENCH, expires_at: iso(NOW - 3600_000) }),
  key('gone', { bound_origin: BENCH, revoked_at: iso(NOW - DAY), expires_at: iso(NOW - DAY) }),
];

const EXPECTED = ['ship1', 'ship2', 'bench1', 'bench2'];

function listedIds() {
  return screen.getAllByTestId('retire-row').map((el) => el.getAttribute('data-key-id'));
}

describe('RetireKeysDialog', () => {
  it('lists exactly the retire plan, with a reason per key', () => {
    render(<RetireKeysDialog keys={keys} now={NOW} revoke={vi.fn()} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(listedIds().sort()).toEqual([...EXPECTED].sort());
    expect(listedIds().sort()).toEqual(retirePlan(keys, NOW).map((c) => c.key.id).sort());
    expect(screen.queryByText('pk_ship3')).toBeNull();
    expect(screen.queryByText('pk_regular')).toBeNull();
    expect(screen.queryByText('pk_gone')).toBeNull();
    expect(screen.getAllByText('Expired').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Replaced by a newer pairing')).toHaveLength(2);
  });

  it('confirming revokes exactly the listed keys and never a live current key', async () => {
    const revoke = vi.fn(async (_id: string) => {});
    const onDone = vi.fn();
    render(<RetireKeysDialog keys={keys} now={NOW} revoke={revoke} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('retire-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const called = revoke.mock.calls.map((c) => c[0]).sort();
    expect(called).toEqual([...EXPECTED].sort());
    expect(called).not.toContain('ship3');
    expect(called).not.toContain('regular');
    expect(called).not.toContain('gone');
    expect(await screen.findByText('Retired 4 of 4.')).toBeTruthy();
  });

  it('the reviewed list is frozen: keys that change after opening are not revoked', async () => {
    const revoke = vi.fn(async (_id: string) => {});
    const onDone = vi.fn();
    const { rerender } = render(
      <RetireKeysDialog keys={keys} now={NOW} revoke={revoke} onClose={vi.fn()} onDone={onDone} />,
    );
    const extra = key('late', { bound_origin: BENCH, expires_at: iso(NOW - 3600_000) });
    rerender(<RetireKeysDialog keys={[...keys, extra]} now={NOW} revoke={revoke} onClose={vi.fn()} onDone={onDone} />);
    expect(listedIds()).not.toContain('late');
    fireEvent.click(screen.getByTestId('retire-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(revoke.mock.calls.map((c) => c[0])).not.toContain('late');
  });

  it('reports a failed revoke and still retires the rest', async () => {
    const revoke = vi.fn(async (id: string) => {
      if (id === 'bench1') throw new Error('database is locked');
    });
    const onDone = vi.fn();
    render(<RetireKeysDialog keys={keys} now={NOW} revoke={revoke} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('retire-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(revoke).toHaveBeenCalledTimes(4);
    expect(await screen.findByText('Retired 3 of 4.')).toBeTruthy();
    expect(screen.getByText(/database is locked/)).toBeTruthy();
  });
});

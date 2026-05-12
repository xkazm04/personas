import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Smoke tests for the new backend commands shipped this session.
 *
 * The goal is to verify each command is registered, accepts the
 * expected param shape, and returns successfully for the common
 * happy-path call. Deeper behavior (e.g. real Sentry HTTP calls,
 * autonomous-tick scheduling logic) is exercised in unit-level
 * tests on the Rust side; these tests verify the IPC surface
 * exists and is callable from the frontend bridge.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 */

let app: CompanionBridge;

test.describe('Companion backend commands smoke', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('companion_interrupt_turn is idempotent for unknown ids (A5)', async () => {
    // No real turn is in flight; the registry just adds an entry that
    // will never be consulted. Repeated calls should not throw.
    await app.invokeCommand('companion_interrupt_turn', { turnId: 'nonexistent-1' });
    await app.invokeCommand('companion_interrupt_turn', { turnId: 'nonexistent-1' });
    await app.invokeCommand('companion_interrupt_turn', { turnId: 'nonexistent-2' });
  });

  test('companion_cancel_autonomy is idempotent with no pending tick (A2)', async () => {
    // Sets the flag; no scheduled task to abort yet. Should succeed.
    await app.invokeCommand('companion_cancel_autonomy');
    await app.invokeCommand('companion_cancel_autonomy');
  });

  test('companion_list_active_connectors returns an array', async () => {
    // The companion's pinned connector list — exposed via
    // `companion_list_active_connectors`. Empty or populated, but
    // always an array.
    const result = await app.invokeCommand<Array<{ connectorName: string }>>(
      'companion_list_active_connectors',
    );
    expect(Array.isArray(result)).toBe(true);
  });

  test('companion_get_cockpit returns null or a spec', async () => {
    // Singleton: null when no cockpit composed, otherwise an object
    // with spec_json + updated_at.
    const result = await app.invokeCommand<
      { specJson: string; updatedAt: string } | null
    >('companion_get_cockpit');
    if (result !== null) {
      expect(typeof result.specJson).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
    }
  });

  test('companion_list_jobs accepts optional flags', async () => {
    // Phase G: background jobs registry. Signature:
    // (only_unresolved?: bool, limit?: u32). Test both shapes.
    const all = await app.invokeCommand<unknown[]>('companion_list_jobs', {});
    expect(Array.isArray(all)).toBe(true);

    const unresolved = await app.invokeCommand<unknown[]>(
      'companion_list_jobs',
      { onlyUnresolved: true, limit: 10 },
    );
    expect(Array.isArray(unresolved)).toBe(true);
  });
});

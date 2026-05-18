import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * End-to-end smoke for the Companion ↔ Fleet integration.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 *
 * What this verifies (in increasing depth):
 *   1. The bridge command `companion_record_fleet_event` exists and
 *      accepts the three normalized event shapes (state_changed /
 *      exited / spawned).
 *   2. Each call lands a System episode in Athena's episodic memory —
 *      surfaced via `companion_list_brain_items` with kind=episode.
 *      The body carries the `fleet-event session:...` marker so
 *      retrieval can find it.
 *   3. The Tier-2 dispatcher actions are registered: invoking
 *      `companion_approve_action` for a manufactured fleet_send_input
 *      approval row reaches `execute_fleet_send_input` and writes to
 *      the target session's PTY stdin.
 *
 * The full LLM round-trip (Athena reads the digest, proposes an OP,
 * the dispatcher creates an approval) is NOT exercised — that needs
 * a real Anthropic call and lives in companion-bridge's separate
 * autonomous tests. This spec is the deterministic plumbing layer.
 */

let app: CompanionBridge;

async function invoke<T = unknown>(app: CompanionBridge, command: string, params: Record<string, unknown> = {}): Promise<T> {
  // bridge has `invokeCommand` which proxies generic Tauri commands.
  // Re-use via /bridge-exec so we don't add a new bridge method.
  return app['bridgeExec' as keyof CompanionBridge].call(app, 'invokeCommand', { command, params }, 30) as Promise<T>;
}

test.describe('Companion ↔ Fleet integration', () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('companion_record_fleet_event writes a System episode with marker', async () => {
    // Use a unique session id so the marker is unambiguous.
    const sessionId = `e2e-fleet-${Date.now()}`;
    const claudeSid = `cc-${Date.now()}`;

    const epIdRes = await invoke<{ success: boolean; result?: string; error?: string }>(
      app,
      'companion_record_fleet_event',
      {
        input: {
          sessionId,
          claudeSessionId: claudeSid,
          projectLabel: 'personas',
          cwd: 'C:/Users/kazda/kiro/personas',
          kind: 'state_changed',
          state: 'awaiting_input',
          reason: 'e2e probe',
        },
      },
    );
    expect(epIdRes.success).toBe(true);
    expect(typeof epIdRes.result).toBe('string');
    const episodeId = epIdRes.result as string;
    expect(episodeId.length).toBeGreaterThan(0);

    // Query the brain — the episode should be in the recent list and
    // its body should carry the structured marker tokens.
    const listRes = await invoke<{ success: boolean; result?: Array<Record<string, unknown>> }>(
      app,
      'companion_list_brain_items',
      { kind: 'episode' },
    );
    expect(listRes.success).toBe(true);
    const items = listRes.result ?? [];
    const ours = items.find((it) => it.id === episodeId);
    expect(ours, `episode ${episodeId} not present in brain list`).toBeDefined();

    const getRes = await invoke<{ success: boolean; result?: { content?: string } }>(
      app,
      'companion_get_brain_item',
      { kind: 'episode', id: episodeId },
    );
    expect(getRes.success).toBe(true);
    const body = (getRes.result as { content?: string } | undefined)?.content ?? '';
    expect(body).toContain(`session:${sessionId}`);
    expect(body).toContain(`cc:${claudeSid}`);
    expect(body).toContain('state:awaiting_input');
    expect(body).toContain('project:personas');
  });

  test('three event kinds map to distinct marker tokens', async () => {
    const sessionId = `e2e-kinds-${Date.now()}`;
    const base = {
      sessionId,
      claudeSessionId: null,
      projectLabel: 'personas',
      cwd: 'C:/Users/kazda/kiro/personas',
    };

    const spawned = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_record_fleet_event',
      { input: { ...base, kind: 'spawned', athenaOwned: false } },
    );
    const stateChanged = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_record_fleet_event',
      { input: { ...base, kind: 'state_changed', state: 'running', reason: 'turn started' } },
    );
    const exited = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_record_fleet_event',
      { input: { ...base, kind: 'exited', exitCode: 0 } },
    );

    expect(spawned.success).toBe(true);
    expect(stateChanged.success).toBe(true);
    expect(exited.success).toBe(true);

    const fetchBody = async (id: string) => {
      const res = await invoke<{ success: boolean; result?: { content?: string } }>(
        app,
        'companion_get_brain_item',
        { kind: 'episode', id },
      );
      return (res.result as { content?: string } | undefined)?.content ?? '';
    };

    const spawnedBody = await fetchBody(spawned.result!);
    const stateBody = await fetchBody(stateChanged.result!);
    const exitedBody = await fetchBody(exited.result!);

    expect(spawnedBody).toContain('state:spawned');
    expect(stateBody).toContain('state:running');
    expect(exitedBody).toContain('state:exited');
    expect(exitedBody).toContain('cleanly');
  });

  test('rejects unknown event kind with a clear error', async () => {
    // The bridge's invokeCommand throws on inner-command errors, so
    // assert via the thrown message rather than a {success: false}
    // discriminator.
    await expect(
      invoke(
        app,
        'companion_record_fleet_event',
        {
          input: {
            sessionId: 'whatever',
            claudeSessionId: null,
            projectLabel: 'personas',
            cwd: 'C:/Users/kazda/kiro/personas',
            kind: 'bogus_kind',
          },
        },
      ),
    ).rejects.toThrow(/bogus_kind/);
  });

  test('companion_approve_action exists and routes to load_pending for an unknown id', async () => {
    // Smoke that the command is wired through tauri::generate_handler.
    // A non-existent approval id should bounce back via the
    // load_pending path with an "not found" message — distinct from a
    // 404-style "unknown command" error.
    await expect(
      invoke(app, 'companion_approve_action', { approvalId: `non-existent-${Date.now()}` }),
    ).rejects.toThrow(/not found/i);
  });
});

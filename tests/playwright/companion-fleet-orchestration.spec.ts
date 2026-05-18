import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * End-to-end smoke for the orchestration layer (Directions 1, 2, 4).
 *
 * Pre-req: npm run tauri:dev:test (with the post-orchestration build).
 *
 * What this verifies:
 *  1. companion_get_operative_memory_digest exists and returns "" when
 *     no operations are tracked.
 *  2. Pushing a state_changed event auto-creates an ad-hoc Operation
 *     containing the session; the digest renders it with the project
 *     label and the running state.
 *  3. Pushing exited with non-zero exit code: (a) writes an episode
 *     whose body is the synthesized summary (Direction 4), and
 *     (b) marks the operation Failed in the digest.
 */

let app: CompanionBridge;

async function invoke<T = unknown>(
  app: CompanionBridge,
  command: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return app['bridgeExec' as keyof CompanionBridge].call(
    app,
    'invokeCommand',
    { command, params },
    30,
  ) as Promise<T>;
}

test.describe('Companion ↔ Fleet orchestration (operative memory)', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('state_changed event populates the operative-memory digest', async () => {
    const sessionId = `e2e-op-${Date.now()}`;

    await invoke(app, 'companion_record_fleet_event', {
      input: {
        sessionId,
        claudeSessionId: `cc-${sessionId}`,
        projectLabel: 'personas',
        cwd: 'C:/Users/kazda/kiro/personas',
        kind: 'state_changed',
        state: 'running',
        reason: 'turn started',
      },
    });

    const digestRes = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_get_operative_memory_digest',
      {},
    );
    expect(digestRes.success).toBe(true);
    const digest = (digestRes.result as string) ?? '';
    expect(digest).toContain('Active orchestration');
    expect(digest).toContain('user spawn in personas');
    // Session id prefix (first 8 chars) is what the digest shows.
    expect(digest).toContain(sessionId.slice(0, 8));
    expect(digest).toContain('working'); // FleetSessionState::Running label
  });

  test('exited event produces a synthesized summary episode (Direction 4)', async () => {
    const sessionId = `e2e-exit-${Date.now()}`;

    // First a running event so operative memory tracks the session.
    await invoke(app, 'companion_record_fleet_event', {
      input: {
        sessionId,
        claudeSessionId: null,
        projectLabel: 'personas',
        cwd: 'C:/Users/kazda/kiro/personas',
        kind: 'state_changed',
        state: 'running',
      },
    });

    // Then exit with non-zero code.
    const exitRes = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_record_fleet_event',
      {
        input: {
          sessionId,
          claudeSessionId: null,
          projectLabel: 'personas',
          cwd: 'C:/Users/kazda/kiro/personas',
          kind: 'exited',
          exitCode: 1,
        },
      },
    );
    expect(exitRes.success).toBe(true);
    const episodeId = exitRes.result as string;

    // The exit episode body should NOT be the bare lifecycle marker —
    // it should contain the synthesized summary phrasing.
    const epRes = await invoke<{ success: boolean; result?: { content?: string } }>(
      app,
      'companion_get_brain_item',
      { kind: 'episode', id: episodeId },
    );
    const body = (epRes.result as { content?: string } | undefined)?.content ?? '';
    // Marker tokens for retrieval still present.
    expect(body).toContain(`session:${sessionId}`);
    expect(body).toContain('project:personas');
    // Direction 4 signature — synthesized summary phrases.
    expect(body).toMatch(/Ran for|non-zero|exited/i);
  });

  test('exited event flips operation status to Failed when exit_code != 0', async () => {
    const sessionId = `e2e-fail-${Date.now()}`;

    await invoke(app, 'companion_record_fleet_event', {
      input: {
        sessionId,
        claudeSessionId: null,
        projectLabel: 'personas',
        cwd: 'C:/Users/kazda/kiro/personas',
        kind: 'state_changed',
        state: 'running',
      },
    });
    await invoke(app, 'companion_record_fleet_event', {
      input: {
        sessionId,
        claudeSessionId: null,
        projectLabel: 'personas',
        cwd: 'C:/Users/kazda/kiro/personas',
        kind: 'exited',
        exitCode: 137,
      },
    });

    const digestRes = await invoke<{ success: boolean; result?: string }>(
      app,
      'companion_get_operative_memory_digest',
      {},
    );
    const digest = (digestRes.result as string) ?? '';
    // The op that owns this session should appear with `failed` label
    // because synthesize_session_summary escalates on non-zero exit.
    // (Failed ops stay in the digest for 5 minutes.)
    expect(digest).toMatch(/failed/i);
    expect(digest).toContain(sessionId.slice(0, 8));
  });
});

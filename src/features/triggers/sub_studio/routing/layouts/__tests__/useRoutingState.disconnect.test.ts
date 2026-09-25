/**
 * Disconnect on a live cable removes the ROUTE, and only after the user confirms.
 *
 * A Studio "Schedule -> B" route is a schedule trigger on B plus the
 * auto-listener the backend pairs with it. Disconnect used to unlink the
 * listener only; the schedule survived and the hourly backfill_auto_listeners
 * tick recreated the listener, so the disconnected route came back. It now
 * deletes the route's primary trigger (the backend cascades the listener) -
 * a row the old path kept - so the confirmation step in front of it is pinned
 * here too: choosing a cable only stages the target, and nothing is deleted
 * until the DisconnectDialog's confirm runs `handleDisconnect`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

const listAllTriggers = vi.fn();
const deleteTrigger = vi.fn();
const unlinkPersonaFromEvent = vi.fn();

vi.mock('@/api/pipeline/triggers', () => ({
  listAllTriggers: (...a: unknown[]) => listAllTriggers(...a),
  deleteTrigger: (...a: unknown[]) => deleteTrigger(...a),
  unlinkPersonaFromEvent: (...a: unknown[]) => unlinkPersonaFromEvent(...a),
  linkPersonaToEvent: vi.fn(),
  renameEventType: vi.fn(),
}));

vi.mock('@/api/overview/events', () => ({
  listEvents: () => Promise.resolve([]),
  listAllSubscriptions: () => Promise.resolve([]),
  deleteSubscription: vi.fn(),
}));

import { useRoutingState } from '../useRoutingState';

function row(id: string, personaId: string, triggerType: string, config: Record<string, unknown>): PersonaTrigger {
  return {
    id, persona_id: personaId, trigger_type: triggerType, config: JSON.stringify(config),
    enabled: true, status: 'active', last_triggered_at: null, next_trigger_at: null,
    trigger_version: 0, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    use_case_id: null, responsibility_id: null, unattended_mode: 'auto',
  };
}

beforeEach(() => {
  listAllTriggers.mockReset().mockResolvedValue([
    row('S', 'B', 'schedule', { cron: '0 3 * * 1' }),
    row('L', 'B', 'event_listener', { listen_event_type: 'trigger_fired', source_filter: 'S', _auto_for_trigger: 'S' }),
  ]);
  deleteTrigger.mockReset().mockResolvedValue(true);
  unlinkPersonaFromEvent.mockReset().mockResolvedValue(true);
});

describe('useRoutingState disconnect', () => {
  it('staging a cable deletes nothing; the confirm deletes the source trigger, not its listener', async () => {
    const { result } = renderHook(() => useRoutingState({ personas: [], teams: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const connections = result.current.rows.flatMap((r) => r.connections);
    expect(connections).toHaveLength(1);
    const connection = connections[0]!;

    act(() => result.current.setDisconnectTarget({ connection, personaName: 'B', eventLabel: 'trigger_fired' }));
    expect(deleteTrigger).not.toHaveBeenCalled();
    expect(unlinkPersonaFromEvent).not.toHaveBeenCalled();

    await act(async () => { await result.current.handleDisconnect(); });
    expect(deleteTrigger).toHaveBeenCalledTimes(1);
    expect(deleteTrigger).toHaveBeenCalledWith('S', 'B');
    expect(unlinkPersonaFromEvent).not.toHaveBeenCalled();
    expect(result.current.disconnectTarget).toBeNull();
  });

  it('[guard] the ledger runs handleDisconnect only as the DisconnectDialog confirm', () => {
    const src = readFileSync(resolve(__dirname, '../../../StudioPatchbay.tsx'), 'utf8');
    const uses = src.match(/routing\.handleDisconnect/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(src).toMatch(/<DisconnectDialog[\s\S]*?onConfirm=\{routing\.handleDisconnect\}/);
  });
});

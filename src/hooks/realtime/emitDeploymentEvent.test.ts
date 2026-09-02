import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitMock = vi.fn((_name: string, _payload: unknown) => Promise.resolve());
vi.mock('@tauri-apps/api/event', () => ({
  emit: (name: string, payload: unknown) => emitMock(name, payload),
}));

import { emitDeploymentEvent } from './emitDeploymentEvent';
import { rankEventsForFeed, hasServerOrderingKey } from '@/features/overview/sub_events/libs/useEventLog';
import type { PersonaEvent } from '@/lib/types/types';

function dbRow(id: string, createdAt: string): PersonaEvent {
  return {
    id,
    project_id: 'proj-1',
    event_type: 'persona.executed',
    source_type: 'engine',
    source_id: null,
    target_persona_id: null,
    payload: null,
    status: 'completed',
    error_message: null,
    processed_at: null,
    created_at: createdAt,
    use_case_id: null,
    retry_count: 0,
  };
}

function lastEmitted(): PersonaEvent {
  const call = emitMock.mock.calls.at(-1);
  if (!call) throw new Error('emit was never called');
  // The mock's payload arg is typed `unknown`; emitDeploymentEvent only ever
  // passes the PersonaEvent it just built.
  return call[1] as PersonaEvent;
}

describe('emitDeploymentEvent', () => {
  beforeEach(() => emitMock.mockClear());

  it('does not mint an ordering key from the renderer clock', () => {
    emitDeploymentEvent({ eventType: 'deploy_started', target: 'cloud', personaId: 'p1', status: 'pending' });

    const event = lastEmitted();
    expect(event.created_at).toBe('');
    expect(event.processed_at).toBeNull();
    // The row is never persisted, so it never acquires a server key.
    expect(hasServerOrderingKey(event)).toBe(false);
  });

  it('carries the renderer observation time in the payload, where nothing ranks on it', () => {
    emitDeploymentEvent({ eventType: 'deploy_succeeded', target: 'gitlab', detail: 'project:42' });

    const payload = JSON.parse(lastEmitted().payload!);
    expect(payload.local_only).toBe(true);
    expect(payload.detail).toBe('project:42');
    expect(payload.target).toBe('gitlab');
    expect(Number.isNaN(Date.parse(payload.observed_at))).toBe(false);
  });

  it('never enters the created_at ranking of the event feed', () => {
    emitDeploymentEvent({ eventType: 'deploy_failed', target: 'cloud', status: 'failed' });
    const deployEvent = lastEmitted();

    // Database rows written today; the deploy event's renderer clock would have
    // landed it among them at an arbitrary point.
    const feed = [
      dbRow('db-new', '2026-09-02T12:00:00Z'),
      deployEvent,
      dbRow('db-old', '2026-09-01T12:00:00Z'),
    ];

    expect(rankEventsForFeed(feed, 'desc').map((e) => e.id)).toEqual([
      deployEvent.id, 'db-new', 'db-old',
    ]);
    // And in oldest-first it rides at the other end — still outside the ranking.
    expect(rankEventsForFeed(feed, 'asc').map((e) => e.id)).toEqual([
      'db-old', 'db-new', deployEvent.id,
    ]);
  });
});

describe('rankEventsForFeed', () => {
  it('ranks rows that carry a server key and leaves keyless rows in arrival order', () => {
    const keyless = { ...dbRow('local-a', ''), source_type: 'deployment' };
    const keyless2 = { ...dbRow('local-b', 'not-a-date'), source_type: 'deployment' };
    const feed = [
      dbRow('db-1', '2026-09-01T00:00:00Z'),
      keyless,
      dbRow('db-2', '2026-09-03T00:00:00Z'),
      keyless2,
      dbRow('db-3', '2026-09-02T00:00:00Z'),
    ];

    expect(rankEventsForFeed(feed, 'desc').map((e) => e.id)).toEqual([
      'local-a', 'local-b', 'db-2', 'db-3', 'db-1',
    ]);
  });
});

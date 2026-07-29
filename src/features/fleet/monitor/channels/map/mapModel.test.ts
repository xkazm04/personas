import { describe, expect, it } from 'vitest';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import {
  buildConstellation, hashUnit, pickCore, trafficEdges, TRAFFIC_WINDOW_MS,
  type MapMemberInput,
} from './mapModel';

const NOW = Date.parse('2026-07-28T12:00:00Z');

function member(id: string, role: string): MapMemberInput {
  return { memberId: `m-${id}`, personaId: id, role, name: id, color: '#8888ff' };
}

function conn(from: string, to: string, type = 'hierarchy'): PersonaTeamConnection {
  return {
    id: `${from}->${to}`,
    team_id: 't1',
    source_member_id: `m-${from}`,
    target_member_id: `m-${to}`,
    connection_type: type,
    condition: null,
    label: null,
    created_at: '',
  };
}

function event(from: string, consumers: string[], at: string): TeamChannelItem {
  return {
    id: `${from}:${at}`,
    kind: 'event',
    at,
    personaId: from,
    label: 'team_handoff.completed',
    body: null,
    assignmentId: null,
    stepId: null,
    extra: null,
    replyTo: null,
    deliberationId: null,
    importance: null,
    consumers,
  };
}

describe('pickCore', () => {
  it('prefers the orchestrator role', () => {
    const core = pickCore([member('a', 'worker'), member('b', 'orchestrator')], []);
    expect(core?.personaId).toBe('b');
  });

  it('falls back to highest out-degree', () => {
    const core = pickCore(
      [member('a', 'worker'), member('b', 'worker')],
      [conn('b', 'a'), conn('b', 'a', 'routing')],
    );
    expect(core?.personaId).toBe('b');
  });

  it('returns null for an empty roster', () => {
    expect(pickCore([], [])).toBeNull();
  });
});

describe('buildConstellation', () => {
  const members = [
    member('orch', 'orchestrator'),
    member('w1', 'worker'),
    member('w2', 'worker'),
    member('r1', 'reviewer'),
  ];

  it('centers the core and rings the satellites', () => {
    const { nodes, core } = buildConstellation(members, [], 900, 560);
    expect(core?.personaId).toBe('orch');
    expect(core?.x).toBe(450);
    expect(core?.y).toBe(280);
    const sats = nodes.filter((n) => !n.core);
    expect(sats).toHaveLength(3);
    for (const s of sats) {
      const d = Math.hypot(s.x - 450, s.y - 280);
      expect(d).toBeGreaterThan(100); // on the ring, not at center
    }
  });

  it('is deterministic — identical input, identical layout', () => {
    const a = buildConstellation(members, [], 900, 560);
    const b = buildConstellation(members, [], 900, 560);
    expect(a.nodes).toEqual(b.nodes);
  });

  it('translates structural edges to persona ids and drops dangling ones', () => {
    const { structure } = buildConstellation(members, [conn('orch', 'w1'), conn('orch', 'ghost')], 900, 560);
    expect(structure).toEqual([{ from: 'orch', to: 'w1', type: 'hierarchy' }]);
  });
});

describe('trafficEdges', () => {
  const ids = new Set(['a', 'b', 'c']);

  it('fans an event out to each consumer and dedupes routes at the newest event', () => {
    const edges = trafficEdges(
      [
        event('a', ['b', 'c'], '2026-07-28T11:59:00Z'),
        event('a', ['b'], '2026-07-28T11:50:30Z'),
      ],
      ids,
      NOW,
    );
    const ab = edges.find((e) => e.from === 'a' && e.to === 'b');
    expect(ab?.count).toBe(2);
    expect(ab?.at).toBe(Date.parse('2026-07-28T11:59:00Z'));
    expect(edges.find((e) => e.to === 'c')?.count).toBe(1);
  });

  it('expires routes past the traffic window', () => {
    const old = new Date(NOW - TRAFFIC_WINDOW_MS - 1000).toISOString();
    expect(trafficEdges([event('a', ['b'], old)], ids, NOW)).toHaveLength(0);
  });

  it('ignores self-routes and non-member endpoints', () => {
    const edges = trafficEdges([event('a', ['a', 'zz'], '2026-07-28T11:59:00Z')], ids, NOW);
    expect(edges).toHaveLength(0);
  });
});

describe('hashUnit', () => {
  it('is stable and salted', () => {
    expect(hashUnit('persona-1')).toBe(hashUnit('persona-1'));
    expect(hashUnit('persona-1', 7)).not.toBe(hashUnit('persona-1', 13));
    const v = hashUnit('anything');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

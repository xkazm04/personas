import { describe, it, expect } from 'vitest';
import {
  parseV2Specs,
  readTeamBridgeSpec,
  buildBridgeSpec,
  upsertTeamBridgeSpec,
  removeTeamBridgeSpec,
  type TeamBridgeDraft,
} from '../teamBridgeSpec';

/** An ordinary (NON-bridge) Slack notification spec. The whole point of these
 *  tests: this must survive every bridge write byte-for-byte. */
const PLAIN_SLACK = {
  type: 'slack',
  enabled: true,
  credential_id: 'cred-alerts',
  use_case_ids: ['uc-1'],
  event_filter: ['execution.failed'],
  config: { channel: 'C-ALERTS' },
};

const BUILT_IN = {
  type: 'built-in',
  enabled: true,
  credential_id: null,
  use_case_ids: '*',
  event_filter: null,
  config: null,
};

const draft: TeamBridgeDraft = {
  teamId: 'team-1',
  credentialId: 'cred-bridge',
  channel: 'C-BRIDGE',
  channelName: 'ops',
  pollInbound: true,
  outboundMessages: true,
  outboundDirectives: false,
  outboundSteps: false,
};

describe('parseV2Specs', () => {
  it('treats null/blank as an empty v2 array', () => {
    expect(parseV2Specs(null)).toEqual([]);
    expect(parseV2Specs('   ')).toEqual([]);
    expect(parseV2Specs('[]')).toEqual([]);
  });

  it('rejects shape A objects, shape B arrays, and malformed JSON', () => {
    expect(parseV2Specs('{"slack":{"channel":"C1"}}')).toBeNull();
    expect(parseV2Specs('[{"type":"slack","config":{"channel":"C1"}}]')).toBeNull();
    expect(parseV2Specs('[not json')).toBeNull();
  });
});

describe('readTeamBridgeSpec', () => {
  it('finds the bridge for the team and ignores plain Slack specs', () => {
    const raw = JSON.stringify([PLAIN_SLACK, buildBridgeSpec(draft)]);
    const read = readTeamBridgeSpec(raw, 'team-1');
    expect(read).toMatchObject({
      credentialId: 'cred-bridge',
      channel: 'C-BRIDGE',
      channelName: 'ops',
      pollInbound: true,
      outboundMessages: true,
      outboundDirectives: false,
      outboundSteps: false,
    });
  });

  it('returns null for another team and for a plain Slack channel', () => {
    const raw = JSON.stringify([PLAIN_SLACK, buildBridgeSpec(draft)]);
    expect(readTeamBridgeSpec(raw, 'team-2')).toBeNull();
    expect(readTeamBridgeSpec(JSON.stringify([PLAIN_SLACK]), 'team-1')).toBeNull();
  });

  it('tolerates snake_case flags written by another writer', () => {
    const raw = JSON.stringify([
      {
        type: 'slack',
        enabled: true,
        credential_id: 'c',
        use_case_ids: '*',
        event_filter: null,
        config: { team_bridge: true, team_id: 'team-1', channel_id: 'C9', poll_inbound: true, outbound_steps: true },
      },
    ]);
    expect(readTeamBridgeSpec(raw, 'team-1')).toMatchObject({
      channel: 'C9',
      pollInbound: true,
      outboundSteps: true,
      outboundMessages: false,
    });
  });
});

describe('upsertTeamBridgeSpec', () => {
  it('appends to an empty blob', () => {
    const result = upsertTeamBridgeSpec(null, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const specs = JSON.parse(result.json);
    expect(specs).toHaveLength(1);
    expect(specs[0].use_case_ids).toBe('*');
    expect(specs[0].config.teamBridge).toBe(true);
  });

  it('PRESERVES unrelated channels when adding a bridge', () => {
    const raw = JSON.stringify([BUILT_IN, PLAIN_SLACK]);
    const result = upsertTeamBridgeSpec(raw, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const specs = JSON.parse(result.json);
    expect(specs).toHaveLength(3);
    expect(specs[0]).toEqual(BUILT_IN);
    expect(specs[1]).toEqual(PLAIN_SLACK);
  });

  it('PRESERVES unrelated channels when editing an existing bridge, replacing in place', () => {
    const raw = JSON.stringify([PLAIN_SLACK, buildBridgeSpec(draft), BUILT_IN]);
    const result = upsertTeamBridgeSpec(raw, { ...draft, channel: 'C-NEW', outboundSteps: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const specs = JSON.parse(result.json);
    expect(specs).toHaveLength(3);
    expect(specs[0]).toEqual(PLAIN_SLACK);
    expect(specs[2]).toEqual(BUILT_IN);
    expect(specs[1].config.channel).toBe('C-NEW');
    expect(specs[1].config.outboundSteps).toBe(true);
  });

  it('leaves another team\'s bridge alone', () => {
    const other = buildBridgeSpec({ ...draft, teamId: 'team-2', channel: 'C-OTHER' });
    const result = upsertTeamBridgeSpec(JSON.stringify([other]), draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const specs = JSON.parse(result.json);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual(other);
  });

  it('refuses a legacy blob rather than corrupting it', () => {
    expect(upsertTeamBridgeSpec('{"slack":{"channel":"C1"}}', draft)).toEqual({ ok: false, reason: 'legacy_shape' });
    expect(upsertTeamBridgeSpec('[{"type":"slack"}]', draft)).toEqual({ ok: false, reason: 'legacy_shape' });
  });
});

describe('removeTeamBridgeSpec', () => {
  it('drops only the bridge, keeping every other channel', () => {
    const other = buildBridgeSpec({ ...draft, teamId: 'team-2' });
    const raw = JSON.stringify([PLAIN_SLACK, buildBridgeSpec(draft), other, BUILT_IN]);
    const result = removeTeamBridgeSpec(raw, 'team-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual([PLAIN_SLACK, other, BUILT_IN]);
  });

  it('is a no-op when the team has no bridge', () => {
    const raw = JSON.stringify([PLAIN_SLACK]);
    const result = removeTeamBridgeSpec(raw, 'team-9');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual([PLAIN_SLACK]);
  });
});
